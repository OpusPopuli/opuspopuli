import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  batchTransaction,
  extractJsonObjectSlice,
  type DataSourceConfig,
  type ILLMProvider,
} from '@opuspopuli/common';
import { DataType } from '@opuspopuli/region-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { LlmGeneratorBase } from './llm-generator.base';
import { civicsSyncTracker } from './sync-phase-logger';

/**
 * Output token budget for one civics extraction.
 *
 * Raised from 32,000 after it silently cut off a good extraction. Measured
 * 2026-09-24 on `assembly.ca.gov/resources/glossary`, captured in full:
 *
 *   prompt          71,750 chars (~18K tokens)
 *   response       141,786 chars of well-formed JSON, 211 complete glossary
 *                  terms, then cut mid-string inside term 211
 *   finishReason   'length'  (i.e. the ceiling, not the model stopping)
 *
 * At ~4.4 chars/token that response was already at the 32,000 ceiling with the
 * page unfinished, so the budget has to roughly double to hold it: 64,000
 * tokens is ~280,000 chars, comfortably past the ~250 terms that page carries.
 *
 * REQUIRES a context window that can hold prompt + output. 18K in plus 64K out
 * is 82K, which fits the 131,072 a deployment should set via
 * LLM_INGESTION_CONTEXT_TOKENS — but NOTHING TRACKED SETS IT (see
 * .env.example, where it is commented out). With the window unset the deployed
 * GGUF build defaults to ~16K, the prompt alone already exceeds it, and a
 * bigger output budget just buys more degraded generation. Set the window and
 * this budget together; neither is much use alone.
 *
 * Per-source `llmMaxTokens` OVERRIDES this. California's three civics sources
 * carry 64,000 as of @opuspopuli/regions 1.0.97 (opuspopuli-regions#87); note
 * `packages/region-provider` pins that version SEPARATELY from
 * `apps/backend`, and region-provider's is the one the service resolves
 * from — see #1328.
 *
 * The cost is only paid when the model actually generates that much; a small
 * page stops on its own long before the ceiling. What a full budget COSTS in
 * time was measured wrong at first and is worth stating correctly:
 *
 *   short civics calls   ~63 tok/s   (38 tokens in 10s — the empty pages)
 *   the 253-term glossary 22.5 tok/s  (36,972 tokens in 27m52s)
 *
 * Long generations run ~3x slower per token than short ones, so sizing a
 * timeout from the short-call rate underestimates by that factor. A FULL
 * 64,000-token run is therefore ~47 min, not the ~15 min first estimated.
 *
 * Which means no timeout currently in play bounds this budget: the sources set
 * 22 min and `LLM_HEADERS_TIMEOUT_FLOOR_MS` is 22.5 min. The 27m52s run above
 * completed anyway, past its own 22-minute deadline without aborting — see
 * #1329, which is unresolved. Treat the bound as unenforced until it is.
 */
export const CIVICS_MAX_OUTPUT_TOKENS = 64000;

/**
 * Optional sampling seed — OFF by default, and deliberately so.
 *
 * Civics extraction is non-deterministic: two identical syncs on 2026-09-24
 * disagreed about two of 24 pages. `how-qualify-initiative` returned nothing on
 * the first run and 10,871 bytes on the second; `information-help-you-follow-process`
 * did the reverse. Same model, same prompt, same content, `temperature: 0.1`,
 * no seed.
 *
 * The obvious response is to pin a seed. That would be wrong here, and the
 * review of this change caught it: `QueueService` gives every job 3 attempts
 * with backoff, and the civics cron runs weekly. A page that currently
 * extracts on roughly half its attempts would, with a fixed seed, fail on all
 * three attempts and on every run thereafter — the same roll, forever. Pinning
 * would trade flakiness for permanent, silent coverage loss.
 *
 * So variance stays in production, where a retry is a second chance, and
 * determinism is opt-in for the place that actually needs it: measuring whether
 * a prompt change helped. Set CIVICS_EXTRACTION_SEED to pin a run.
 *
 * Attestation does not need this either — the output row already carries
 * `promptHash`, `promptVersion`, `llmModel` and `llmDigest`.
 */
function civicsSeed(): number | undefined {
  const raw = process.env.CIVICS_EXTRACTION_SEED?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Minimal provider contract for civics ingestion. Civics consumes
 * declarative `dataSources` registered by the region plugin — the
 * orchestrator owns the plugin lookup, civics consumes the resulting
 * list. `getDataSources` is intentionally typed loosely (matches the
 * declarative-plugin signature) to avoid a hard import dependency.
 */
export interface CivicsProvider {
  getName?(): string;
  /** Optional because some legacy / mock providers don't expose the
   *  declarative dataSource registry. The sync short-circuits early
   *  when this is absent. */
  getDataSources?(filter?: DataType): DataSourceConfig[];
}

/**
 * Shared HTTP / HTML helpers passed in by the orchestrator (#828 follow-up
 * will consolidate these into a shared module after the bills extraction
 * in Step 7 lands). Bills also uses these — until that consolidation,
 * passing them as callbacks keeps CivicsSyncService free of an
 * orchestrator-class dependency that would create a circular DI graph.
 */
export interface CivicsCrawlHelpers {
  fetchUrlText(url: string): Promise<string>;
  htmlToReadableText(html: string): string;
  crawlCivicsUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
  ): Promise<string[]>;
}

/**
 * Owns civics-data ingestion (extracted from RegionSyncService as #828
 * Step 5). Phases: discover → extract_and_upsert. Each declarative
 * civics data source is crawled within scope, then each discovered URL
 * is LLM-extracted into a `CivicsBlock` row plus the per-region
 * glossary upserts.
 */
@Injectable()
export class CivicsSyncService extends LlmGeneratorBase {
  private readonly logger = new Logger(CivicsSyncService.name, {
    timestamp: true,
  });

  constructor(
    db: DbService,
    @Optional() promptClient?: PromptClientService,
    // ILLMProvider is an interface (erased at runtime), so there is no
    // implicit injection token — NestJS resolves it by the explicit token
    // LLMModule provides. Without @Inject here, @Optional() silently yields
    // `undefined` and civics sync no-ops. See #869.
    //
    // The INGESTION lane (roadmap §6.4), unlike every other generator on this
    // base: civics extraction pulls structured facts out of scraped pages —
    // chambers, measure types, lifecycle, glossary — which is an extraction
    // job rather than a synthesis one. It is the other half of the workload
    // measured as job-1, alongside structural analysis.
    @Optional() @Inject('LLM_INGESTION_PROVIDER') llm?: ILLMProvider,
  ) {
    // This class used to only *mirror* LlmGeneratorBase's constructor. It now
    // inherits it (#1281), so civics extraction goes through the same
    // attribution write path as every other generator instead of assembling
    // its own — which is how `llm_model` came to be stamped here but the
    // digest would not have been.
    super(undefined, promptClient, llm, db);
  }

  async sync(
    plugin: CivicsProvider,
    helpers: CivicsCrawlHelpers,
  ): Promise<{ processed: number; created: number; updated: number }> {
    // `db` joins this guard because LlmGeneratorBase declares it optional —
    // a generator can legitimately be constructed without one. Civics sync
    // cannot, so it refuses here rather than asserting its way through.
    if (!this.promptClient || !this.llm || !this.db) {
      this.logger.warn(
        'Civics sync requires PromptClient, LLM provider and DbService; skipping',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    if (!plugin?.getDataSources) {
      this.logger.warn(
        'Region plugin does not expose getDataSources(); skipping civics sync',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    const dataSources = plugin.getDataSources!(DataType.CIVICS);
    if (dataSources.length === 0) {
      this.logger.log('No civics data sources configured for this region');
      return { processed: 0, created: 0, updated: 0 };
    }

    const registeredHosts = new Set(
      plugin.getDataSources!().flatMap((s) => {
        try {
          return [new URL(s.url).hostname];
        } catch {
          return [];
        }
      }),
    );

    const regionId = plugin.getName?.() ?? 'unknown';
    let processed = 0;
    let created = 0;
    let updated = 0;

    // ─── Phase 1/2 — discover ──────────────────────────────────────
    const discoverTracker = civicsSyncTracker(
      this.logger,
      'discover',
      dataSources.length,
      { region: regionId },
    );
    const allUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    for (const ds of dataSources) {
      const urls = await helpers.crawlCivicsUrls(ds, registeredHosts);
      discoverTracker.item({
        name: ds.url,
        externalId: null,
        outcomeLabel: `${urls.length} page(s) at depth ${ds.crawlDepth ?? 0}`,
        outcome: 'updated',
      });
      for (const url of urls) allUrls.push({ url, ds });
    }
    discoverTracker.complete();

    // ─── Phase 2/2 — extract_and_upsert ────────────────────────────
    const extractTracker = civicsSyncTracker(
      this.logger,
      'extract_and_upsert',
      allUrls.length,
      { region: regionId },
    );
    for (const { url, ds } of allUrls) {
      const result = await this.extractAndUpsertPage(
        regionId,
        url,
        ds,
        helpers,
      );
      if (result === 'created') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'created',
          outcome: 'created',
        });
        created++;
        processed++;
      } else if (result === 'updated') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'updated',
          outcome: 'updated',
        });
        updated++;
        processed++;
      } else if (result === 'failed') {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'failed',
          outcome: 'error',
        });
      } else {
        extractTracker.item({
          name: url,
          externalId: null,
          outcomeLabel: 'skipped',
          outcome: 'skipped',
        });
      }
    }
    extractTracker.complete();

    return { processed, created, updated };
  }

  /**
   * Write the exact prompt and response of a failed extraction to disk, so the
   * failure can be reproduced offline instead of guessed at.
   *
   * **Opt-in, via `CIVICS_CAPTURE_DIR`.** Off by default and deliberately not
   * a log line: the prompt embeds scraped civic text, which under #1263 can
   * carry proponent contact details. Logs are shipped, indexed and retained;
   * a file written only when an operator asks for it is not. The `warn` above
   * carries sizes, hashes and `finishReason` — enough to triage — and none of
   * the text.
   *
   * Never throws. A diagnostic that can fail a sync is worse than no
   * diagnostic, and this runs on the path that is already failing.
   */
  private async captureFailedExtraction(
    sourceUrl: string,
    promptText: string,
    responseText: string,
  ): Promise<void> {
    const dir = process.env.CIVICS_CAPTURE_DIR;
    if (!dir) return;

    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { createHash } = await import('node:crypto');
      const stamp = createHash('sha256')
        .update(sourceUrl)
        .digest('hex')
        .slice(0, 12);
      await mkdir(dir, { recursive: true });
      await writeFile(
        `${dir}/civics-${stamp}.prompt.txt`,
        `# ${sourceUrl}\n# promptChars=${promptText.length}\n\n${promptText}`,
        'utf8',
      );
      await writeFile(
        `${dir}/civics-${stamp}.response.txt`,
        responseText,
        'utf8',
      );
      this.logger.warn(
        `Captured the failing civics prompt and response to ${dir}/civics-${stamp}.* ` +
          `— contains scraped civic text; delete it when the investigation is done`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not capture the failing civics extraction: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Fetch a civics page, send it through the civics-extraction prompt,
   * upsert the resulting `CivicsBlock` and glossary entries.
   */
  private async extractAndUpsertPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    helpers: CivicsCrawlHelpers,
  ): Promise<'created' | 'updated' | 'failed' | 'skipped'> {
    if (!this.promptClient || !this.llm) return 'failed';
    try {
      const html = await helpers.fetchUrlText(sourceUrl);
      const content = helpers.htmlToReadableText(html);
      const { promptText, promptHash, promptVersion } =
        await this.promptClient.getCivicsExtractionPrompt({
          regionId,
          sourceUrl,
          contentGoal: ds.contentGoal,
          category: ds.category,
          hints: ds.hints,
          html: content,
        });

      const maxTokens = ds.llmMaxTokens ?? CIVICS_MAX_OUTPUT_TOKENS;
      const result = await this.llm.generate(promptText, {
        maxTokens,
        temperature: 0.1,
        ...(civicsSeed() !== undefined ? { seed: civicsSeed() } : {}),
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(result.text);
      if (!candidate) {
        // The old line said only "no JSON object" and a character count, which
        // is why this cost a day: it cannot distinguish "the model wrote prose
        // instead of JSON" from "the model was still writing valid JSON when
        // it hit the token ceiling". `finishReason` answers that outright and
        // was already on the result, discarded.
        //
        // Adding `hitTokenCeiling` to the structured fields was not enough:
        // the MESSAGE still said "no JSON object", and that is the part a human
        // reads. It was written up as a "32,000-token runaway producing no
        // JSON" — three descriptions of the ceiling doing its job — and stayed
        // an open mystery for two days. So the message itself now names the
        // cause and the fix.
        const ceilingHit = result.finishReason === 'length';
        this.logger.warn(
          {
            sourceUrl,
            finishReason: result.finishReason,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            maxTokens,
            hitTokenCeiling: ceilingHit,
            // The INPUT side of the same question. Both were already on the
            // result and neither was logged, which is how "the prompt was
            // silently truncated" stays invisible at this exact moment.
            promptTruncated: result.promptTruncated,
            promptTokensEstimated: result.promptTokensEstimated,
            promptChars: promptText.length,
            contentChars: content.length,
            promptVersion,
            promptHash,
            responseChars: result.text.length,
            responseHead: result.text.slice(0, 160),
          },
          ceilingHit
            ? `Civics extraction: output TRUNCATED at the ${maxTokens}-token ` +
                `ceiling for ${sourceUrl} — the model was still writing valid ` +
                `JSON (${result.text.length} chars) when it was cut off. This is ` +
                `a budget problem, not a model or prompt problem: raise ` +
                `llmMaxTokens for this data source.`
            : // NOT "so it must be the prompt". There is a third cause this
              // cannot see from here: a prompt cut on the way IN. With num_ctx
              // unset the model may never reach the JSON-format instructions at
              // the tail of the prompt, answer in prose, and report 'stop' — and
              // #1322's detector misses an overflow this mild, because 16,386
              // tokens read of ~17,937 sent is 91% coverage, well above the 50%
              // threshold. Naming the candidates beats asserting one of them.
              `Civics extraction: no JSON object for ${sourceUrl} — the model ` +
                `stopped on its own (${result.finishReason ?? 'reason unreported'}) ` +
                `without producing one. Not a budget problem. Check, in order: ` +
                `whether the prompt was cut on input (promptTruncated below, and ` +
                `tokensIn vs promptTokensEstimated), then the prompt, then the model.`,
        );
        await this.captureFailedExtraction(sourceUrl, promptText, result.text);
        return 'failed';
      }

      let block: Partial<{
        chambers: unknown;
        measureTypes: unknown;
        lifecycleStages: unknown;
        sessionScheme: unknown;
        glossary: unknown;
      }>;
      try {
        block = JSON.parse(candidate) as typeof block;
      } catch (e) {
        // The THIRD failure class, and until now the only one that captured
        // nothing. A slice with balanced braces that still will not parse is
        // almost always a bad escape inside a string — a raw control character,
        // or a `\x`/`\'` the model invented — some thousands of characters into
        // otherwise perfect output. The message alone cannot be acted on: the
        // offending bytes are the whole question, and they are not in the log.
        //
        // Observed twice on 2026-09-24, on different pages each time, and not
        // reproducible on a re-run because extraction is unseeded. A failure
        // that moves between runs and leaves no artifact cannot be fixed, which
        // is exactly the position the output-ceiling failure was in for two days.
        const message = (e as Error).message;
        const at = /position (\d+)/.exec(message)?.[1];
        const around = at
          ? candidate.slice(Math.max(0, Number(at) - 60), Number(at) + 60)
          : undefined;
        this.logger.warn(
          {
            sourceUrl,
            parseError: message,
            // The bytes either side of the offending position, which is what a
            // human actually needs. Scraped civic text, like the rest of the
            // prompt — same disclosure as the capture below.
            around,
            candidateChars: candidate.length,
            responseChars: result.text.length,
            finishReason: result.finishReason,
            promptVersion,
            promptHash,
          },
          `Civics extraction: JSON.parse failed for ${sourceUrl} at ` +
            `position ${at ?? 'unknown'} — the response had a complete JSON ` +
            `object that is not valid JSON, usually a bad escape inside a ` +
            `string. Not a budget problem and not a missing object.`,
        );
        await this.captureFailedExtraction(sourceUrl, promptText, result.text);
        return 'failed';
      }

      // A page the crawler reached under the source's scope but that holds no
      // civic content (e.g. dining services, records-request) extracts to a
      // well-formed but entirely empty block. Persisting it creates a noise
      // CivicsBlock, so skip the upsert entirely. See #874.
      if (isEmptyCivicsExtraction(block)) {
        this.logger.log(
          `Civics extraction: no civic content on ${sourceUrl} — skipping empty block`,
        );
        return 'skipped';
      }

      const existing = await this.db!.civicsBlock.findUnique({
        where: { regionId_sourceUrl: { regionId, sourceUrl } },
        select: { id: true },
      });

      const fields = {
        chambers: toJsonField(block.chambers),
        measureTypes: toJsonField(block.measureTypes),
        lifecycleStages: toJsonField(block.lifecycleStages),
        sessionScheme: toJsonField(block.sessionScheme),
        glossary: toJsonField(block.glossary),
      };

      // Built by the base class, not assembled here (#1281). `llm` is
      // non-null past the guard above; the digest identifies WHICH weights
      // produced the block, because `ollama pull` can move a tag.
      const provenance = await this.outputProvenance({
        promptHash,
        promptVersion,
      });

      await this.db!.civicsBlock.upsert({
        where: { regionId_sourceUrl: { regionId, sourceUrl } },
        create: {
          regionId,
          sourceUrl,
          ...fields,
          promptHash: provenance.promptHash,
          promptVersion: provenance.promptVersion,
          llmModel: provenance.llmModel,
          llmDigest: provenance.llmModelDigest,
          extractedAt: new Date(),
        },
        update: {
          ...fields,
          promptHash: provenance.promptHash,
          promptVersion: provenance.promptVersion,
          llmModel: provenance.llmModel,
          llmDigest: provenance.llmModelDigest,
          extractedAt: new Date(),
        },
      });

      const glossaryUpserted = await this.upsertGlossaryEntries(
        regionId,
        sourceUrl,
        block.glossary,
        promptHash,
        promptVersion,
      );

      const outcome = existing ? 'updated' : 'created';
      this.logger.log(
        `Civics extracted from ${sourceUrl} (${outcome}, ${glossaryUpserted} glossary terms)`,
      );
      return outcome;
    } catch (e) {
      this.logger.error(
        `Civics extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return 'failed';
    }
  }

  /**
   * Upsert per-term glossary entries from a civics page's `glossary[]`
   * payload. Malformed entries (missing term / slug / definition) are
   * dropped with a debug log; valid entries land in `glossary_entries`
   * keyed by `(regionId, slug)`.
   */
  private async upsertGlossaryEntries(
    regionId: string,
    sourceUrl: string,
    glossary: unknown,
    promptHash: string | undefined,
    promptVersion: string | undefined,
  ): Promise<number> {
    if (!Array.isArray(glossary) || glossary.length === 0) return 0;
    const valid = glossary.filter(
      (
        e,
      ): e is { term: string; slug: string; definition: unknown } & Record<
        string,
        unknown
      > =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).term === 'string' &&
        typeof (e as Record<string, unknown>).slug === 'string' &&
        !!(e as Record<string, unknown>).definition,
    );
    if (valid.length < glossary.length) {
      this.logger.debug(
        `Glossary upsert: dropped ${glossary.length - valid.length} malformed entries from ${sourceUrl}`,
      );
    }
    const now = new Date();
    await batchTransaction(
      this.db!,
      valid.map((entry) => {
        // Shared fields are identical between create and update — extract
        // once to keep the upsert body deduplicated.
        const shared = {
          term: entry.term,
          definition: entry.definition as Prisma.InputJsonValue,
          longDefinition: toJsonField(entry.longDefinition),
          relatedTerms: Array.isArray(entry.relatedTerms)
            ? (entry.relatedTerms as string[]).filter(
                (t) => typeof t === 'string',
              )
            : [],
          sourceUrl,
          promptHash,
          promptVersion,
          extractedAt: now,
        };
        return this.db!.glossaryEntry.upsert({
          where: { regionId_slug: { regionId, slug: entry.slug } },
          create: { regionId, slug: entry.slug, ...shared },
          update: shared,
        });
      }),
    );
    return valid.length;
  }
}

/**
 * Module-level helper for civics-block JSONB column writes. Maps
 * `undefined`/`null` to `Prisma.DbNull` (which Prisma needs to clear a
 * JSONB column) and passes anything else through unchanged.
 */
function toJsonField(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

/**
 * True when an extracted civics block carries no civic content at all — every
 * list field empty/absent and no session scheme. The crawler reaches non-civic
 * utility pages under a source's scope (dining services, records requests),
 * and the model faithfully returns an empty shell for them; persisting those
 * as `civics_blocks` rows is pure noise. Callers skip the upsert. See #874.
 */
function isEmptyCivicsExtraction(block: {
  chambers?: unknown;
  measureTypes?: unknown;
  lifecycleStages?: unknown;
  sessionScheme?: unknown;
  glossary?: unknown;
}): boolean {
  const isEmptyList = (v: unknown): boolean =>
    !Array.isArray(v) || v.length === 0;
  const isEmptyScheme =
    block.sessionScheme == null ||
    (typeof block.sessionScheme === 'object' &&
      Object.keys(block.sessionScheme as Record<string, unknown>).length === 0);
  return (
    isEmptyList(block.chambers) &&
    isEmptyList(block.measureTypes) &&
    isEmptyList(block.lifecycleStages) &&
    isEmptyList(block.glossary) &&
    isEmptyScheme
  );
}

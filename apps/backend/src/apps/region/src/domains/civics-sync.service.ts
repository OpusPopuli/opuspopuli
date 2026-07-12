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
import { civicsSyncTracker } from './sync-phase-logger';

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
export class CivicsSyncService {
  private readonly logger = new Logger(CivicsSyncService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    @Optional() private readonly promptClient?: PromptClientService,
    // ILLMProvider is an interface (erased at runtime), so there is no
    // implicit injection token — NestJS resolves it by the explicit
    // 'LLM_PROVIDER' token that LLMModule provides. Without @Inject here,
    // @Optional() silently yields `undefined` and civics sync no-ops.
    // Mirrors LlmGeneratorBase. See #869.
    @Optional() @Inject('LLM_PROVIDER') private readonly llm?: ILLMProvider,
  ) {}

  async sync(
    plugin: CivicsProvider,
    helpers: CivicsCrawlHelpers,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!this.promptClient || !this.llm) {
      this.logger.warn(
        'Civics sync requires PromptClient and LLM provider; skipping',
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

      const result = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? 32000,
        temperature: 0.1,
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(result.text);
      if (!candidate) {
        this.logger.warn(
          `Civics extraction: no JSON object for ${sourceUrl} (${result.text.length} chars)`,
        );
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
        this.logger.warn(
          `Civics extraction: JSON.parse failed for ${sourceUrl}: ${(e as Error).message}`,
        );
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

      const existing = await this.db.civicsBlock.findUnique({
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

      await this.db.civicsBlock.upsert({
        where: { regionId_sourceUrl: { regionId, sourceUrl } },
        create: {
          regionId,
          sourceUrl,
          ...fields,
          promptHash,
          promptVersion,
          extractedAt: new Date(),
        },
        update: {
          ...fields,
          promptHash,
          promptVersion,
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
      this.db,
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
        return this.db.glossaryEntry.upsert({
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

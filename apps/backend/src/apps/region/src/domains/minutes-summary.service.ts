import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  extractJsonObjectSlice,
  LLMError,
  parseJsonWithRepair,
  stableHash,
} from '@opuspopuli/common';
import type {
  MinutesSummaryClaim,
  MinutesSummaryClaimKind,
  MinutesSummaryResult,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { normaliseSummaryClaims } from './claim-normalisers';
import { readPositiveInt } from './config-helpers';
import {
  outputCurrency,
  outputSkipKey,
  partitionStale,
  type GeneratedOutputOutcome,
  type LiveOutputKey,
  type OutputCurrency,
  type OutputTarget,
} from './generated-output-key';
import {
  AiOutputProvenance,
  errorKind,
  LlmGeneratorBase,
} from './llm-generator.base';

/** The template this generator is written against, and the only one it accepts. */
export const MINUTES_SUMMARY_TEMPLATE = 'document-analysis-minutes-summary';

/** What the prompt-client serves when the template above is missing (finding M5). */
const GENERIC_TEMPLATE = 'document-analysis-generic';

/** In the config hash and the generate call alike, so the key describes the call. */
const TEMPERATURE = 0.2;

/** Bumped when what this generator stores changes shape. */
const MINUTES_SUMMARY_GENERATOR_VERSION = 'minutes-summary-1';

/**
 * The config axis of the skip key. `maxInputChars` is not in it: the input
 * hash is taken over the truncated text, so a new cap already moves that axis.
 */
export function minutesSummaryConfigHash(maxTokens: number): string {
  return stableHash({
    generator: MINUTES_SUMMARY_GENERATOR_VERSION,
    maxTokens,
    temperature: TEMPERATURE,
  });
}

const VALID_KINDS = new Set<MinutesSummaryClaimKind>([
  'decision',
  'concern',
  'controversy',
  'public_comment',
  'disclosure',
]);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

/** Minimal projection the summarizer reads from a Minutes row. */
interface MinutesForSummary {
  id: string;
  externalId: string;
  body: string;
  date: Date;
  rawText: string | null;
  /** The archived PDF `rawText` was parsed from (#1306). */
  sourceVersionId: string | null;
  summary: string | null;
  summaryPromptHash: string | null;
  summaryLlmDigest: string | null;
  summarySourceHash: string | null;
  summaryConfigHash: string | null;
  summaryFailedKey: string | null;
  summaryFailedAttempts: number;
}

/**
 * Attempts one skip key gets before it is not retried (D5). Not one: at this
 * temperature output length varies run to run, and 2 of the 3 documents that
 * hit the ceiling on every step 3 attempt fit on a later one under the same
 * key (UAT, 2026-11-01). Not unbounded: the third failed every time.
 */
export const MINUTES_SUMMARY_MAX_ATTEMPTS = 3;

/** Rows read per page by `selectStale`. */
const SELECT_PAGE = 50;

/** What a summary's key and input are read from. */
const MINUTES_SELECT = {
  id: true,
  externalId: true,
  body: true,
  date: true,
  rawText: true,
  sourceVersionId: true,
  summary: true,
  summaryPromptHash: true,
  summaryLlmDigest: true,
  summarySourceHash: true,
  summaryConfigHash: true,
  summaryFailedKey: true,
  summaryFailedAttempts: true,
} as const;

/** How one generation attempt ended. */
type Attempt =
  | 'written'
  /** The model's output was unusable: cut off, not JSON, or no synopsis. */
  | 'output_refused'
  /** Anything else — the prompt guard, the LLM call, the write. Not recorded. */
  | 'error';

/**
 * Where a JSON.parse failed, without what it failed on. V8's "Unexpected
 * token" message quotes ~20 characters of the input, and the input here is
 * the model quoting the minutes verbatim — which name members of the public.
 */
function parseErrorAt(error: unknown): string {
  const position = /position (\d+)/.exec((error as Error).message)?.[1];
  return position ? `position ${position}` : 'an unknown position';
}

/**
 * Ollama's abort when a generation loops: the model's output failing, like a
 * cut-off, not the call (D5). It arrives thrown, so without this it read as
 * transient and was retried every sync, uncounted (UAT 2026-11-01, 08-14).
 * Ollama's own message, which quotes nothing of the prompt.
 */
function isRepetitionAbort(error: unknown): boolean {
  return (
    error instanceof LLMError &&
    /token repeat limit/i.test(error.originalError?.message ?? '')
  );
}

/** What selection found: the stale rows, and the rows it skipped and why. */
export interface MinutesSelection {
  pending: OutputTarget[];
  /** Current on every axis. */
  current: number;
  /** Stale, but the key has used up its attempts (D5). */
  failedBefore: number;
}

function hasText(row: MinutesForSummary): boolean {
  return !!row.rawText && row.rawText.trim().length > 0;
}

/**
 * The shape of a refused response, never its text (§3: minutes name members
 * of the public). Enough to tell a long claim list from a loop (§4c): a loop
 * repeats claims, so the distinct titles fall far below the claims begun.
 * Titles and lines are read only to be counted: return counts, nothing else.
 */
export function responseShape(text: string): string {
  const titles = [...text.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => m[1],
  );
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const repeated = lines.length - new Set(lines).size;
  return (
    `chars=${text.length} claims=${(text.match(/"kind"\s*:/g) ?? []).length} ` +
    `distinctTitles=${new Set(titles).size}/${titles.length} ` +
    `repeatedLines=${repeated}/${lines.length}`
  );
}

/**
 * Generates a plain-English synopsis + structured claims for meeting minutes
 * (daily journals / weekly histories), writing `Minutes.summary` and
 * `Minutes.summaryClaims`. Mirrors {@link PropositionAnalysisService}: read
 * source text → prompt-service template → LLM → JSON-salvage + normalize →
 * write JSONB. See #813.
 *
 * A summary is regenerated when its skip key moves — the live prompt, the
 * live weights, the input text or the settings (meetings-phase-b.md §3, the
 * representatives rule in `generated-output-key.ts`) — or when `force` is set.
 */
@Injectable()
export class MinutesSummaryService
  extends LlmGeneratorBase
  implements OnModuleInit
{
  private readonly logger = new Logger(MinutesSummaryService.name);
  /**
   * 8000, from 4000 (meetings-phase-b.md §4c): one journal (2026-09-25)
   * carries 25 distinct claims and was still mid-JSON at 4000 on every
   * attempt — a long record, not a loop, so the budget moves rather than the
   * record shrinking. 2000 → 4000 before that (§3). Part of the config hash,
   * so changing it regenerates every summary once.
   */
  private readonly maxTokens = readPositiveInt(
    this.config,
    'MINUTES_SUMMARY_MAX_TOKENS',
    8000,
  );
  /**
   * Cap the rawText handed to the LLM to bound cost + stay within context
   * (largest observed journal ~262 KB). One-shot truncation is fine for now;
   * multi-pass is a filed follow-up (#813 out-of-scope).
   */
  private readonly maxInputChars = readPositiveInt(
    this.config,
    'MINUTES_SUMMARY_MAX_INPUT_CHARS',
    60000,
  );

  /**
   * The effective settings, in both region (which selects) and region-worker
   * (which summarizes): the two read them from separate environments, and
   * disagreeing they key every summary differently (§4d).
   */
  onModuleInit(): void {
    this.logger.log(
      `minutes-summary config: maxTokens=${this.maxTokens} maxInputChars=${this.maxInputChars} ` +
        `configHash=${this.configHash().slice(0, 12)}`,
    );
  }

  /**
   * Summarize one minutes row — the `minutes-summary` job. Re-checks currency
   * first, so a job queued before another run wrote the summary does nothing.
   * `force` (the regenerate mutation) skips the currency check only.
   */
  async summarize(
    minutesId: string,
    force = false,
  ): Promise<GeneratedOutputOutcome> {
    if (!this.promptClient || !this.llm || !this.db) return 'skipped';

    const row: MinutesForSummary | null = await this.db.minutes.findUnique({
      where: { id: minutesId },
      select: MINUTES_SELECT,
    });
    if (!row) {
      this.logger.warn(`Minutes ${minutesId} not found`);
      return 'skipped';
    }
    if (!hasText(row)) {
      this.logger.debug(`Skipping ${row.externalId}: no rawText to summarize`);
      return 'skipped';
    }
    const { live, currency } = await this.assess(row);
    if (!force && currency !== 'stale') {
      if (currency === 'legacy') await this.stamp(row.id, live);
      return 'unchanged';
    }
    if (!force && this.failedBefore(row, live)) {
      // D5: the same prompt, model, text and config failed every allowed
      // attempt. The job can arrive by the fallback path, which skips
      // selection.
      this.logger.debug(
        `minutes-summary ${row.externalId}: failed ${row.summaryFailedAttempts} times under this key; not retried`,
      );
      return 'skipped';
    }
    const attempt = await this.tryGenerateAndPersist(row, live);
    if (attempt === 'output_refused') await this.recordFailure(row, live);
    if (attempt !== 'written') return 'failed';
    return row.summary ? 'updated' : 'created';
  }

  /** D5: whether this row used up its attempts under the live key. */
  private failedBefore(row: MinutesForSummary, live: LiveOutputKey): boolean {
    const key = outputSkipKey(live);
    return (
      key !== null &&
      row.summaryFailedKey === key &&
      row.summaryFailedAttempts >= MINUTES_SUMMARY_MAX_ATTEMPTS
    );
  }

  /**
   * Count a model-output refusal against its key (D5): a new key starts at
   * one, the same key adds one. Not recorded when the key cannot be known,
   * nor for a transient error (the LLM call, the write, the prompt guard):
   * those retry without spending an attempt.
   */
  private async recordFailure(
    row: MinutesForSummary,
    live: LiveOutputKey,
  ): Promise<void> {
    const key = outputSkipKey(live);
    if (key === null) return;
    try {
      // Conditional on the stored key, not the one read at job start: a
      // forced job can fail beside a keyed one. Increment under this key,
      // else claim the row for it, else another job claimed it first.
      if (await this.countFailure(row.id, key)) return;
      const claimed = await this.db!.minutes.updateMany({
        where: {
          id: row.id,
          OR: [{ summaryFailedKey: null }, { summaryFailedKey: { not: key } }],
        },
        data: { summaryFailedKey: key, summaryFailedAttempts: 1 },
      });
      if (claimed.count === 0) await this.countFailure(row.id, key);
    } catch (error) {
      // Not recording only costs a retry next sync.
      this.logger.warn(
        `minutes-summary ${row.externalId}: failure not recorded: ${errorKind(error)}`,
      );
    }
  }

  /** Count one more failure if the row is recorded under `key`. */
  private async countFailure(id: string, key: string): Promise<boolean> {
    const { count } = await this.db!.minutes.updateMany({
      where: { id, summaryFailedKey: key },
      data: { summaryFailedAttempts: { increment: 1 } },
    });
    return count > 0;
  }

  /**
   * Which active minutes need a summary: the stale ones, each with its skip
   * key for the job id. Legacy summaries are stamped current on the way.
   * Undefined when the summarizer is not configured, so the caller can fall
   * back rather than read "nothing is stale".
   *
   * Every active row with text, not only the rows this sync wrote: the
   * archive ingest skips PDFs it has seen, so a summary gone stale under a
   * new prompt or model would otherwise wait for its PDF to change. Every
   * row's text is read, because the key covers it: a filter on the stored
   * prompt, model and config would miss a row whose text changed in an
   * earlier sync and whose regeneration then failed transiently, which
   * records no key (meetings-phase-b.md §4f).
   *
   * `failedBefore` counts stale rows not queued because their last attempt
   * failed under the same key (D5).
   */
  async selectStale(): Promise<MinutesSelection | undefined> {
    if (!this.promptClient || !this.llm || !this.db) return undefined;
    const result = {
      pending: [] as OutputTarget[],
      current: 0,
      failedBefore: 0,
    };
    // Paged: the key covers the text, so every row's `rawText` is read, and a
    // daily journal runs 100 kB+. All at once would grow with the corpus.
    let cursor: string | undefined;
    for (;;) {
      const rows: MinutesForSummary[] = await this.db.minutes.findMany({
        // Keyset, not Prisma's `cursor`: a cursor row deleted mid-sync
        // yields an empty page, which would end the walk early.
        where: {
          isActive: true,
          rawText: { not: null },
          ...(cursor && { id: { gt: cursor } }),
        },
        select: MINUTES_SELECT,
        orderBy: { id: 'asc' },
        take: SELECT_PAGE,
      });
      await this.selectPage(rows, result);
      if (rows.length < SELECT_PAGE) return result;
      cursor = rows.at(-1)?.id;
    }
  }

  /** One page of candidates into the selection. */
  private async selectPage(
    rows: MinutesForSummary[],
    result: MinutesSelection,
  ): Promise<void> {
    const page = await partitionStale(rows, {
      assess: async (row) => {
        if (!hasText(row)) return undefined;
        const assessed = await this.assess(row);
        if (
          assessed.currency === 'stale' &&
          this.failedBefore(row, assessed.live)
        ) {
          result.failedBefore++;
          return undefined;
        }
        return assessed;
      },
      stamp: (row, live) => this.stamp(row.id, live),
      target: (row, key) => ({ id: row.id, key, externalId: row.externalId }),
    });
    result.pending.push(...page.pending);
    result.current += page.current;
  }

  /** The config axis of this process's skip keys. */
  configHash(): string {
    return minutesSummaryConfigHash(this.maxTokens);
  }

  /** The live key — over exactly the prompt's input — and how the stored summary compares. */
  private async assess(
    row: MinutesForSummary,
  ): Promise<{ live: LiveOutputKey; currency: OutputCurrency }> {
    const live = await this.liveOutputKey(
      MINUTES_SUMMARY_TEMPLATE,
      this.formatMinutes(row),
      this.configHash(),
    );
    const currency = outputCurrency(
      {
        promptHash: row.summaryPromptHash,
        llmDigest: row.summaryLlmDigest,
        sourceHash: row.summarySourceHash,
        configHash: row.summaryConfigHash,
      },
      live,
    );
    return { live, currency };
  }

  /** Record a legacy summary's input and config as current. */
  private async stamp(id: string, live: LiveOutputKey): Promise<void> {
    await this.db!.minutes.update({
      where: { id },
      data: {
        summarySourceHash: live.sourceHash,
        summaryConfigHash: live.configHash,
      },
    });
  }

  private async tryGenerateAndPersist(
    row: MinutesForSummary,
    live: LiveOutputKey,
  ): Promise<Attempt> {
    try {
      const generated = await this.generateOne(row, live);
      if (generated === 'output_refused' || generated === 'error') {
        return generated;
      }

      await this.db!.minutes.update({
        where: { id: row.id },
        data: {
          summary: generated.payload.summary,
          summaryClaims: generated.payload
            .claims as unknown as Prisma.InputJsonValue,
          summaryPromptHash: generated.provenance.promptHash,
          summaryPromptVersion: generated.provenance.promptVersion,
          summaryLlmModel: generated.provenance.llmModel,
          summaryLlmDigest: generated.provenance.llmModelDigest,
          summarySourceHash: live.sourceHash,
          summaryConfigHash: live.configHash,
          summaryFailedKey: null,
          summaryFailedAttempts: 0,
        },
      });

      // Dual-write into the evidence graph (#1293), after the authoritative
      // blob and never inside its transaction. Minutes claims quote `rawText`
      // verbatim, which makes this the one family the verifier can genuinely
      // check today — propositions still cite by offset, bios cite structured
      // fields.
      //
      // Hashed here because `Minutes` stores no hash of `rawText` — a gap
      // #1279 closed for propositions only — so this is what makes a stale
      // minutes summary detectable later at all.
      const rawText = row.rawText ?? null;
      await this.mirrorClaims(
        {
          subjectType: 'minutes',
          subjectId: row.id,
          claims: normaliseSummaryClaims(generated.payload.claims),
          sourceText: rawText,
          sourceTextHash: rawText
            ? createHash('sha256').update(rawText, 'utf8').digest('hex')
            : null,
          // The archived PDF `rawText` was parsed from (#1306). Matters most
          // here: `rawText` is truncated at 256 kB, so for a long document the
          // archive holds the only complete copy of what was cited.
          sourceVersionId: row.sourceVersionId,
        },
        // `error`, not `warn`: the claims were not written. A systematic
        // failure here is otherwise invisible until something reads the
        // tables, which nothing does yet (#1296).
        (message) => this.logger.error(message),
      );

      return 'written';
    } catch (error) {
      // The error's kind, never its message: a Prisma validation error
      // prints the write's arguments, and `summary`/`summaryClaims` quote the
      // minutes verbatim — the same leak `parseErrorAt` closes.
      if (isRepetitionAbort(error)) {
        this.logger.warn(
          `Minutes summary failed for ${row.externalId}: the model looped (token repeat limit)`,
        );
        return 'output_refused';
      }
      this.logger.warn(
        `Minutes summary failed for ${row.externalId}: ${errorKind(error)}`,
      );
      return 'error';
    }
  }

  private async generateOne(
    row: MinutesForSummary,
    live: LiveOutputKey,
  ): Promise<
    | { payload: MinutesSummaryResult; provenance: AiOutputProvenance }
    | 'output_refused'
    | 'error'
  > {
    const prompt = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'minutes-summary',
      text: this.formatMinutes(row),
    });
    if (await this.servedFallback(prompt.promptHash, live)) {
      // The prompt-client falls back to `document-analysis-generic` when this
      // template is missing, and that prompt asks for no claims. From
      // 2026-09-13 every summary was written that way, silently (finding M5).
      // Refuse instead: no summary is honest, a claimless one under the wrong
      // prompt is not.
      this.logger.error(
        `minutes-summary ${row.externalId}: served prompt ${prompt.promptHash?.slice(0, 12) ?? 'none'} ` +
          `is not ${MINUTES_SUMMARY_TEMPLATE} (${live.promptHash?.slice(0, 12) ?? 'not found'}); nothing written`,
      );
      return 'error';
    }
    const { promptText } = prompt;

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: TEMPERATURE,
    });

    // Cost telemetry — the per-row output is capped by maxTokens; log the
    // actual spend so an operator can watch cumulative usage during a
    // backfill. A Prometheus counter / dashboard panel is a fast-follow.
    if (result.tokensUsed != null) {
      this.logger.debug(
        `minutes-summary ${row.externalId}: ${result.tokensUsed} tokens`,
      );
    }
    if (result.finishReason === 'length') {
      // A cut-off response has no closing brace, so it fails below as "no
      // JSON object" — which reads as a model fault, not a budget one.
      this.logger.warn(
        `minutes-summary ${row.externalId}: output hit the ${this.maxTokens}-token ceiling ` +
          `(${result.tokensOut ?? '?'} out; ${responseShape(result.text)}); raise MINUTES_SUMMARY_MAX_TOKENS`,
      );
    }

    const payload = this.parsePayload(result.text, row);
    if (!payload) return 'output_refused';
    return { payload, provenance: await this.outputProvenance(prompt) };
  }

  /**
   * Whether the prompt-client served the generic fallback instead of this
   * template: the template is not found, or the served hash IS the generic
   * one. Not "served hash != canonical hash": an A/B variant is served under
   * its own hash while `getPromptHash` reports the canonical template's, and
   * that is this template working as intended.
   */
  private async servedFallback(
    servedHash: string | undefined,
    live: LiveOutputKey,
  ): Promise<boolean> {
    if (!live.promptHash) return true;
    if (servedHash === live.promptHash) return false;
    const generic = await this.livePromptHash(GENERIC_TEMPLATE);
    // Unknown generic hash: a variant and the fallback look alike, so refuse.
    // Fail closed, as on a missing template — the job retries next sync.
    return generic === undefined || servedHash === generic;
  }

  private formatMinutes(row: MinutesForSummary): string {
    const raw = row.rawText ?? '';
    const text =
      raw.length > this.maxInputChars ? raw.slice(0, this.maxInputChars) : raw;
    return [
      `ExternalId: ${row.externalId}`,
      `Body: ${row.body}`,
      `Date: ${row.date.toISOString().slice(0, 10)}`,
      '',
      'MinutesText:',
      text,
    ].join('\n');
  }

  private parsePayload(
    text: string,
    row: MinutesForSummary,
  ): MinutesSummaryResult | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      // `warn`: a refusal logged at `debug` is invisible where it matters (#1085).
      this.logger.warn(
        `Summary parse failed for ${row.externalId}: no JSON object (${responseShape(text)})`,
      );
      return undefined;
    }
    let parsed: Partial<MinutesSummaryResult>;
    try {
      parsed = JSON.parse(candidate) as Partial<MinutesSummaryResult>;
    } catch (error) {
      const repaired = parseJsonWithRepair(candidate);
      if (!repaired) {
        this.logger.warn(
          `Summary JSON.parse failed for ${row.externalId} at ${parseErrorAt(error)} ` +
            `(${responseShape(text)})`,
        );
        return undefined;
      }
      // The civics repair (unescaped quotes, trailing commas), shared rather
      // than a second copy: every claim quotes the document verbatim, which
      // is where those defects come from. Not yet seen to fire on minutes —
      // the two parse failures that recurred on UAT were neither class
      // (meetings-phase-b.md §3). At `warn`, because the model emitting
      // invalid JSON is a defect even when it is survivable.
      this.logger.warn(
        `Summary JSON for ${row.externalId} needed repair (${repaired.applied.join(', ')}) ` +
          `at ${parseErrorAt(error)}`,
      );
      parsed = repaired.value as Partial<MinutesSummaryResult>;
    }
    return this.normalize(parsed, row);
  }

  private normalize(
    parsed: Partial<MinutesSummaryResult>,
    row: MinutesForSummary,
  ): MinutesSummaryResult | undefined {
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) {
      // The synopsis is the one field the UI can't recover from — refuse a
      // half-populated result rather than persist an empty summary.
      this.logger.debug(`Summary missing core field for ${row.externalId}`);
      return undefined;
    }
    const claims = Array.isArray(parsed.claims)
      ? (parsed.claims
          .map((c) => this.normalizeClaim(c))
          .filter((c) => c !== null) as MinutesSummaryClaim[])
      : [];
    return { summary, claims };
  }

  private normalizeClaim(c: unknown): MinutesSummaryClaim | null {
    if (!c || typeof c !== 'object') return null;
    const o = c as Record<string, unknown>;
    const kind = o.kind as MinutesSummaryClaimKind;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!VALID_KINDS.has(kind) || !title) return null;

    const citationRaw = (
      o.citation && typeof o.citation === 'object' ? o.citation : {}
    ) as Record<string, unknown>;

    const claim: MinutesSummaryClaim = {
      kind,
      title,
      detail: typeof o.detail === 'string' ? o.detail.trim() : '',
      citation: {
        pageHint:
          typeof citationRaw.pageHint === 'string'
            ? citationRaw.pageHint
            : undefined,
        quote:
          typeof citationRaw.quote === 'string' ? citationRaw.quote : undefined,
      },
    };
    if (Array.isArray(o.billRefs)) {
      claim.billRefs = o.billRefs.filter((b) => typeof b === 'string');
    }
    if (typeof o.severity === 'string' && VALID_SEVERITIES.has(o.severity)) {
      claim.severity = o.severity as MinutesSummaryClaim['severity'];
    }
    return claim;
  }
}

import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService, DocumentType } from '@opuspopuli/relationaldb-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import { MetricsService } from 'src/common/metrics';
import {
  PersonalizedImpact,
  PersonalizedImpactInput,
} from '../dto/personalized-impact.dto';

/**
 * TTL bounds staleness (a read generated under old declared signals or an
 * old measure analysis convention ages out), NOT storage — storage is
 * bounded by the piggybacked sweep in persist(), which deletes rows expired
 * for longer than SWEEP_GRACE_MS on each cache write.
 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SWEEP_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days past expiry

/** Metrics label — distinguishes this cache from the generic-analysis one. */
const METRICS_SERVICE_LABEL = 'documents-personalized-impact';

/**
 * Generates the "What this means to you" read that leads the scan results
 * (#1052): the measure's own AI analysis joined with the citizen's declared
 * signals, turned into a short plain-language impact statement by the LLM.
 *
 * Returns null when there is nothing to personalize — no analysis yet, an
 * empty summary, or no declared signals — so the frontend falls back to the
 * generic analysis (+ a sign-in nudge for anonymous users).
 *
 * Reads are cached in PersonalizedImpactCache keyed by
 * (userId, contentHash, documentType, promptVersion, profileHash):
 * - Per-user on purpose. A cross-user cache is a membership-inference
 *   oracle (probe a profile against a petition you hold and learn whether
 *   someone with those declared attributes scanned it) — found in the
 *   2026-08-22 review; amends plan decision #3.
 * - documentType mirrors the generic analysis cache key (contentHash +
 *   type) — same bytes as petition vs. contract yield different reads.
 * - profileHash invalidates on any declared-signal change; promptVersion
 *   invalidates on template updates.
 * Documents without a contentHash skip the cache and always generate.
 *
 * Availability note: the cache read needs promptVersion, so a prompt-service
 * outage with no local template fallback makes generate() throw even when a
 * warm row exists. Accepted: the mutation error makes the frontend fall
 * back to the generic analysis (plan decision #4) rather than this layer
 * serving version-unverified cached text.
 */
@Injectable()
export class PersonalizedImpactService {
  private readonly logger = new Logger(PersonalizedImpactService.name);

  constructor(
    private readonly db: DbService,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
    private readonly promptClient: PromptClientService,
    private readonly metricsService: MetricsService,
  ) {}

  async generate(
    userId: string,
    input: PersonalizedImpactInput,
  ): Promise<PersonalizedImpact | null> {
    const profile = canonicalizeProfile(input);
    // No declared signals => nothing to personalize against.
    if (
      profile.interestTags.length === 0 &&
      profile.rankingFlags.length === 0
    ) {
      return null;
    }

    const document = await this.db.document.findFirst({
      where: { id: input.documentId, userId },
    });
    if (document?.analysis == null) return null;

    const analysis = document.analysis as Record<string, unknown>;
    const summary =
      typeof analysis.summary === 'string' ? analysis.summary : '';
    if (!summary) return null;

    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : [];

    const { promptText, promptHash, promptVersion } =
      await this.promptClient.getPersonalizedImpactPrompt({
        documentType: document.type,
        summary,
        actualEffect:
          typeof analysis.actualEffect === 'string'
            ? analysis.actualEffect
            : undefined,
        beneficiaries: asStringArray(analysis.beneficiaries),
        potentiallyHarmed: asStringArray(analysis.potentiallyHarmed),
        userInterestTags: profile.interestTags,
        userRankingFlags: profile.rankingFlags,
        userRegionLabel: profile.regionLabel ?? undefined,
      });

    const key: CacheKey = {
      userId,
      contentHash: document.contentHash,
      documentType: document.type,
      promptVersion,
      profileHash: hashProfile(profile),
    };

    const cached = await this.readCached(key);
    if (cached) return cached;

    const result = await this.llm.generate(promptText, {
      maxTokens: 400,
      temperature: 0.3,
    });
    const text = result.text.trim();
    // The template's contract: the exact sentinel SKIP means the LLM found
    // no defensible personal connection. Treat like empty — fall back to
    // the generic analysis, and never cache a sentinel as a read.
    if (!text || /^skip\.?$/i.test(text)) return null;

    await this.persist(key, {
      impactText: text,
      promptHash,
      tokensUsed:
        typeof result.tokensUsed === 'number' ? result.tokensUsed : null,
    });

    return {
      text,
      provider: this.llm.getName(),
      model: this.llm.getModelName(),
      promptVersion,
      fromCache: false,
    };
  }

  private async readCached(key: CacheKey): Promise<PersonalizedImpact | null> {
    if (!key.contentHash) return null;

    const row = await this.db.personalizedImpactCache.findFirst({
      where: {
        userId: key.userId,
        contentHash: key.contentHash,
        documentType: key.documentType,
        promptVersion: key.promptVersion,
        profileHash: key.profileHash,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      this.metricsService.recordAnalysisCacheMiss(METRICS_SERVICE_LABEL);
      return null;
    }

    this.metricsService.recordAnalysisCacheHit(METRICS_SERVICE_LABEL);
    return {
      text: row.impactText,
      provider: row.llmProvider ?? undefined,
      model: row.llmModel ?? undefined,
      promptVersion: key.promptVersion,
      fromCache: true,
    };
  }

  private async persist(
    key: CacheKey,
    generated: {
      impactText: string;
      promptHash: string | null;
      tokensUsed: number | null;
    },
  ): Promise<void> {
    if (!key.contentHash) return;

    const row = {
      ...generated,
      llmProvider: this.llm.getName(),
      llmModel: this.llm.getModelName(),
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    };

    try {
      // The atomic upsert doubles as the race guard: two concurrent
      // first-generates for the same key both pay the LLM, then
      // last-write-wins on one row — correct for a deterministic key.
      await this.db.personalizedImpactCache.upsert({
        where: {
          userId_contentHash_documentType_promptVersion_profileHash: {
            userId: key.userId,
            contentHash: key.contentHash,
            documentType: key.documentType,
            promptVersion: key.promptVersion,
            profileHash: key.profileHash,
          },
        },
        create: { ...key, contentHash: key.contentHash, ...row },
        update: row,
      });

      // Piggybacked storage sweep — writes are the only moment this table
      // grows, so they also collect long-expired rows (any user's; there is
      // no dedicated cron). Awaited so a test/caller sees a settled state.
      await this.db.personalizedImpactCache.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - SWEEP_GRACE_MS) } },
      });
    } catch (error) {
      // A lost cache write must not lose the generated read. Never log the
      // raw error — Prisma validation errors embed full query args,
      // including the profile-revealing impact text.
      this.logger.warn(
        `Failed to cache personalized impact: ${
          error instanceof Error ? error.constructor.name : 'unknown error'
        }`,
      );
    }
  }
}

interface CacheKey {
  userId: string;
  contentHash: string | null;
  documentType: DocumentType;
  promptVersion: string;
  profileHash: string;
}

interface CanonicalProfile {
  interestTags: string[];
  rankingFlags: string[];
  regionLabel: string | null;
}

/**
 * Canonicalize the declared-signal profile once, and use the SAME value for
 * both the prompt and the hash — deduped, codepoint-sorted, whitespace-only
 * region label normalized to null. Equivalent declarations therefore render
 * the same prompt AND share the same cache row.
 */
function canonicalizeProfile(input: PersonalizedImpactInput): CanonicalProfile {
  // Codepoint order, NOT localeCompare — the hash must be identical across
  // runtimes/locales for the cache key to be stable.
  const byCodepoint = (a: string, b: string) => (a < b ? -1 : Number(a > b));
  const canonicalize = (values: string[]) =>
    Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort(
      byCodepoint,
    );
  return {
    interestTags: canonicalize(input.interestTags),
    rankingFlags: canonicalize(input.rankingFlags),
    regionLabel: input.regionLabel?.trim() || null,
  };
}

function hashProfile(profile: CanonicalProfile): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

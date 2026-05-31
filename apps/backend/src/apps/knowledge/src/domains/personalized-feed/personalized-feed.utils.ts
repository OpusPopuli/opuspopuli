import type { RankingFlagsInputDto } from './dto/personalization-input.dto';

/**
 * Shared shape of a bill's AI-extracted summary as persisted on
 * `Bill.aiSummary` (Json column). Optional everywhere — the LLM may
 * omit any field. Used by the rerank service when building the
 * `BillRelevanceExplanationParams` for the prompt-client.
 */
export interface BillAiSummary {
  plainEnglishSummary?: string;
  topics?: string[];
  whoItAffects?: string[];
  fiscalImpact?: { level?: string; summary?: string };
  stakeholderImpact?: string;
}

/**
 * Project the 20-boolean `RankingFlagsInputDto` down to the TRUE-only
 * slug array the prompt-service + validator expect. Centralized here to
 * keep the same transformation consistent across the resolver, the
 * rerank service, and the worker scheduler.
 */
export function toTrueFlagNames(flags: RankingFlagsInputDto): string[] {
  return Object.entries(flags)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/**
 * Runtime-validate that a `Bill.aiSummary` Json value is a plain object
 * (not an array, not a scalar, not null). The Json column is widely
 * typed and a malformed entry would silently produce undefined fields
 * downstream — fail closed by returning an empty object so callers'
 * `?? ''` and `?? []` defaults kick in instead of an unsafe cast.
 */
export function coerceAiSummary(value: unknown): BillAiSummary {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as BillAiSummary;
}

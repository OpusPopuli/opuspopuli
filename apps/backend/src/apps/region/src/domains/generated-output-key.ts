import { createHash } from 'node:crypto';
import { buildSkipKey } from '@opuspopuli/common';

/**
 * The skip key for a generated AI output (representatives Phase B,
 * `docs/plans/representatives-phase-b.md` §1) — the rule proposition analysis
 * follows (K-P2), shared by every representatives generator so the four do
 * not each invent one. An output is CURRENT when it was produced by the live
 * prompt, the live weights, the same input and the same generation settings.
 */

/**
 * What one output's job reports. `unchanged`: current by the time it ran (or
 * a legacy row, stamped). `skipped`: nothing to generate from (gone, no input).
 * A transient failure throws instead, so the queue retries it.
 */
export type GeneratedOutputOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'skipped'
  | 'failed';

/** A stale output, as a generator's `selectStale` returns it. */
export interface OutputTarget {
  id: string;
  /** The skip key — the job id's last part; null when it cannot be known. */
  key: string | null;
}

/** What a stored output records about how it was produced. */
export interface StoredOutputKey {
  promptHash: string | null;
  llmDigest: string | null;
  sourceHash: string | null;
  configHash: string | null;
}

/**
 * The values a current output must match. `promptHash` and `modelDigest` are
 * undefined when their lookup failed — that axis is then not checked this
 * run, rather than every output regenerating on one failed call (the
 * propositions rule).
 */
export interface LiveOutputKey {
  promptHash?: string;
  modelDigest?: string;
  sourceHash: string;
  configHash: string;
}

/**
 * `legacy`: produced by the live prompt and weights before the input and
 * config axes existed — stamped current, not regenerated (owner, 2026-10-27).
 */
export type OutputCurrency = 'current' | 'legacy' | 'stale';

/** SHA-256 of exactly what the prompt is given — "the input changed" means the model would see something different. */
export function inputHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function outputCurrency(
  stored: StoredOutputKey,
  live: LiveOutputKey,
): OutputCurrency {
  // Never attributed: produced before #1149, or never produced.
  if (!stored.promptHash) return 'stale';
  if (live.promptHash && stored.promptHash !== live.promptHash) return 'stale';
  if (live.modelDigest && stored.llmDigest !== live.modelDigest) return 'stale';
  // Missing and NULL are the same claim: "never recorded".
  if (
    (stored.sourceHash ?? null) === null &&
    (stored.configHash ?? null) === null
  ) {
    return 'legacy';
  }
  return stored.sourceHash === live.sourceHash &&
    stored.configHash === live.configHash
    ? 'current'
    : 'stale';
}

/**
 * The job-id key for a stale output: the same inputs always name the same job
 * (a duplicate request collapses onto it), and null when the key cannot be
 * known — an unresolved prompt hash or digest — so the job gets a one-off id.
 */
export function outputSkipKey(live: LiveOutputKey): string | null {
  if (!live.promptHash || !live.modelDigest) return null;
  return buildSkipKey({
    sourceHash: live.sourceHash,
    promptHash: live.promptHash,
    modelDigest: live.modelDigest,
    configHash: live.configHash,
  });
}

/** How one row's stored output compares with the live key. */
export interface AssessedOutput {
  live: LiveOutputKey;
  currency: OutputCurrency;
}

/** Rows assessed at once — each assessment is a DB read or two. */
const ASSESS_CONCURRENCY = 8;

/**
 * Split candidate rows into the stale ones (up to `cap`, in row order) and a
 * count of the current ones, stamping legacy rows on the way — every
 * generator's `selectStale`, once.
 *
 * Assessed a few at a time rather than one by one: the activity generator's
 * assessment is two queries per entity, and ~200 of them in series was the
 * selection's whole cost.
 *
 * @param spec.assess - The row's assessment, or undefined to leave it out
 *   (nothing to generate from)
 */
export async function partitionStale<R, T>(
  rows: readonly R[],
  spec: {
    assess: (row: R) => Promise<AssessedOutput | undefined>;
    stamp: (row: R, live: LiveOutputKey) => Promise<void>;
    target: (row: R, key: string | null) => T;
    cap?: number;
  },
): Promise<{ pending: T[]; current: number }> {
  const result = { pending: [] as T[], current: 0 };
  for (let i = 0; i < rows.length; i += ASSESS_CONCURRENCY) {
    const chunk = rows.slice(i, i + ASSESS_CONCURRENCY);
    const assessed = await Promise.all(chunk.map((row) => spec.assess(row)));
    for (const [j, a] of assessed.entries()) {
      if (a) await place(chunk[j], a, spec, result);
    }
  }
  return result;
}

/** One assessed row into the partition: queued if stale (under the cap), else counted. */
async function place<R, T>(
  row: R,
  a: AssessedOutput,
  spec: {
    stamp: (row: R, live: LiveOutputKey) => Promise<void>;
    target: (row: R, key: string | null) => T;
    cap?: number;
  },
  result: { pending: T[]; current: number },
): Promise<void> {
  if (a.currency === 'stale') {
    if (spec.cap === undefined || result.pending.length < spec.cap) {
      result.pending.push(spec.target(row, outputSkipKey(a.live)));
    }
    return;
  }
  if (a.currency === 'legacy') await spec.stamp(row, a.live);
  result.current++;
}

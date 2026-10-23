/**
 * The skip key: one value that changes whenever any input that can change an
 * output changes (`docs/plans/ingestion-resource-lanes.md` §4, shared rule).
 *
 * Every skip fix (K1–K6) and every lane job id (§6) is built from this, so no
 * skip invents its own notion of "unchanged". A skip that ignores one input
 * serves stale output after that input moves — measured on civics, where
 * region config moved the output MORE than the prompt did.
 *
 * The same key is the attestation: the output row persists the inputs, and a
 * reader can recompute the key to prove which source, prompt, weights and
 * config produced it.
 */

import { createHash } from "node:crypto";

/**
 * Everything that can change an output. All four are required, `configHash`
 * included: a caller whose prompt takes no region config passes `null`
 * deliberately, rather than forgetting the field and silently ignoring a
 * config change.
 */
export interface SkipKeyInputs {
  /** Hash of the source content the output was derived from. */
  sourceHash: string;
  /** Hash of the prompt template, as prompt-service attests it. */
  promptHash: string;
  /**
   * Resolved digest of the model weights (#1281), not the tag — `ollama pull`
   * can change the weights behind an unchanged tag.
   */
  modelDigest: string;
  /**
   * Hash of the region config that feeds the prompt ({@link stableHash} of
   * it), or `null` when no config does.
   */
  configHash: string | null;
}

/**
 * Digest values that identify no weights. A key built on one would match
 * another run on DIFFERENT weights that also failed to resolve, so it must
 * never be used to skip. `unknown` is `UNKNOWN_MODEL_DIGEST` in the region
 * generator base.
 */
const UNRESOLVED_DIGESTS: ReadonlySet<string> = new Set(["", "unknown"]);

/**
 * Bumped when the key's formula changes, so a new formula can never match a
 * key stored under the old one.
 */
const SKIP_KEY_VERSION = "sk1";

/**
 * The skip key for these inputs, or `null` when they cannot support a skip.
 *
 * `null` means "always run": the model digest did not resolve, or an input
 * is empty. Returned rather than thrown because it is an ordinary state — a
 * node whose Ollama is briefly unreachable — and the safe response is to do
 * the work, not to fail the sync.
 */
export function buildSkipKey(inputs: SkipKeyInputs): string | null {
  // Trimmed, and tolerant of a missing value from an untyped caller: a blank
  // or absent input cannot support a skip, so it means "always run" — the
  // safe answer — rather than a TypeError mid-sync.
  const sourceHash = clean(inputs.sourceHash);
  const promptHash = clean(inputs.promptHash);
  const modelDigest = clean(inputs.modelDigest);
  const configHash =
    inputs.configHash === null ? null : clean(inputs.configHash);
  if (UNRESOLVED_DIGESTS.has(modelDigest)) return null;
  if (!sourceHash || !promptHash || configHash === "") return null;

  // A JSON array, not a delimited string: JSON escapes every value, so no
  // input can contain a delimiter and shift into its neighbour's field
  // (`x|prompt=y` + `z` against `x` + `y|prompt=z` collided in a joined
  // string), and `null` stays distinct from any string, `"none"` included.
  const canonical = JSON.stringify([
    SKIP_KEY_VERSION,
    sourceHash,
    promptHash,
    modelDigest,
    configHash,
  ]);
  return `${SKIP_KEY_VERSION}-${sha256(canonical)}`;
}

/**
 * sha256 of a JSON value whose object keys are sorted at every depth, so the
 * same config hashes the same however it was assembled. For `configHash`.
 *
 * `undefined` object members are dropped, as `JSON.stringify` drops them —
 * so `{a: 1}` and `{a: 1, b: undefined}` are the same config.
 *
 * Throws on anything that is not plain JSON data — a `Date`, `Map`, `Set` or
 * class instance. Key-sorting would flatten each to `{}`, so a change inside
 * one would never change the hash: a silent stale skip. Config is parsed
 * JSON; anything else reaching here is a caller bug worth hearing about.
 *
 * JSON's own conflations still apply and are accepted: `NaN` and `undefined`
 * array members hash as `null`. A cycle overflows the stack.
 */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(sortKeys(value));
  // `JSON.stringify(undefined)` is undefined, which would surface as an
  // opaque crypto TypeError; say what actually went wrong.
  if (json === undefined) {
    throw new TypeError("stableHash: value is not JSON-serialisable");
  }
  return sha256(json);
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `stableHash: ${proto?.constructor?.name ?? "object"} is not plain JSON data`,
    );
  }
  // No prototype: on a plain `{}`, assigning the key `__proto__` calls the
  // prototype setter instead of adding a member, so `{"__proto__": …}` from
  // parsed JSON hashed as `{}` whatever it held.
  const sorted: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Separator for {@link laneJobId}. NOT `:` — BullMQ 5 accepts a colon in a
 * custom job id only when the id splits into exactly three parts (a
 * compatibility path for old repeatable jobs), and its source marks that for
 * removal in the next breaking release. `<entity>:<stage>:<key>` would work
 * today by accident and break on the first entity id that contains a colon.
 */
const JOB_ID_SEPARATOR = "__";

/**
 * What one part of a {@link laneJobId} may be: letters, digits, `-` and
 * single INTERNAL underscores (`stage_backfill`). Banning `__` alone was not
 * enough — `a_` + `b` and `a` + `_b` both join to `a___b`, so a part may
 * neither start nor end with `_`. No `:` (see {@link JOB_ID_SEPARATOR}).
 */
const JOB_ID_PART = /^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/;

/**
 * A lane job id: `<entity>__<stage>__<skipKey>` (§6, "job identity is the
 * attestation key"). One id gives dedupe — BullMQ refuses a duplicate — and
 * idempotent retries.
 *
 * Throws on a part outside {@link JOB_ID_PART}, because two different units
 * of work sharing an id means the second enqueue is silently dropped as a
 * duplicate.
 *
 * Never build one from a `null` {@link buildSkipKey} result (as `"null"`,
 * say, which the pattern would accept): null means "always run", and a
 * fixed id would dedupe every such run into the first.
 */
export function laneJobId(
  entity: string,
  stage: string,
  skipKey: string,
): string {
  for (const part of [entity, stage, skipKey]) {
    if (!JOB_ID_PART.test(part)) {
      throw new Error(
        `laneJobId: "${part}" must match ${JOB_ID_PART} — letters, digits, ` +
          `"-" and single internal "_"`,
      );
    }
  }
  return [entity, stage, skipKey].join(JOB_ID_SEPARATOR);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Defensive regex compilation for LLM-generated extraction rules.
 *
 * The structural analyzer asks an LLM (qwen3.5:9b in dev, qwen3.5:35b in
 * prod) to produce extraction rules including regex patterns. The LLM is
 * trained on a polyglot corpus and routinely emits Python/PCRE-style
 * inline flag groups — `(?m)`, `(?i)`, `(?s)` — at the start of patterns
 * (e.g. `(?m)^COMMITTEE HEARINGS` for the CA Senate daily-file PDF).
 * JavaScript's RegExp engine doesn't accept inline flag groups and
 * throws "Invalid regular expression: Invalid group" at compile time,
 * which previously surfaced as an extraction error and dropped the
 * entire source's items on the floor.
 *
 * This module:
 *   1. Strips known leading inline flag groups and folds them into the
 *      flags argument JS-style (`(?m)pat` → pattern `pat` with `m` flag).
 *   2. Wraps `new RegExp()` in a try/catch so a malformed pattern returns
 *      `undefined` rather than throwing — callers decide whether to
 *      fall through to a default behavior or skip the rule entirely.
 *
 * Inline groups handled (Python `re` and PCRE syntax):
 *   - `(?m)`  multiline   → flag `m`
 *   - `(?i)`  ignore case → flag `i`
 *   - `(?s)`  dotall      → flag `s`
 *   - `(?u)`  unicode     → flag `u`
 *   - `(?x)`  extended    → not supported by JS, dropped (the LLM
 *     occasionally emits it but our extraction patterns don't actually
 *     rely on its whitespace-allowance semantics)
 *   - Combinations like `(?ms)`, `(?im)`           → both flags applied
 *   - Negative inline `(?-m)`                      → not supported, dropped
 *
 * Anything else (named groups, lookbehinds, etc.) is left untouched —
 * those are syntactic features that JS does support, and we shouldn't
 * try to reinterpret them.
 */

const SUPPORTED_INLINE_FLAGS = new Set(["i", "m", "s", "u"]);

/**
 * Result of preparing a pattern for `new RegExp()`. Exposed for tests
 * and for callers that want to log the normalized form.
 */
export interface PreparedPattern {
  pattern: string;
  flags: string;
  /** True if any inline-flag prefix was stripped from the input. */
  normalized: boolean;
  /** Inline flags that were dropped because JS doesn't support them. */
  droppedFlags: string[];
}

/**
 * Strip leading inline flag groups (`(?m)`, `(?ims)`, `(?-m)`, even stacked
 * `(?s)(?m)`) from a pattern and fold the supported ones into the flags
 * string. Returns the rewritten pattern plus the merged flags.
 *
 * Why loop: the LLM occasionally emits **multiple consecutive** inline-flag
 * groups (real CA Senate daily-file case: `(?s)(?m)^COMMITTEE HEARINGS`).
 * A single-pass strip leaves the inner `(?m)` behind and JS rejects it.
 */
export function preparePattern(
  pattern: string,
  defaultFlags = "",
): PreparedPattern {
  const inlineFlagGroup = /^\(\?([a-zA-Z-]+)\)/;
  const supported = new Set(defaultFlags.split(""));
  const droppedFlags: string[] = [];
  let remaining = pattern;
  let normalized = false;

  // Strip every leading inline-flag group, accumulating flags as we go.
  while (true) {
    const match = inlineFlagGroup.exec(remaining);
    if (!match) break;
    normalized = true;

    const flagSpec = match[1];
    remaining = remaining.slice(match[0].length);

    // Negative inline flags ("(?-m)") aren't supported by JS at all and we
    // can't model "turn off m" without already having it on. Drop them
    // (the strip already happened; just don't add anything to flags).
    if (flagSpec.includes("-")) {
      droppedFlags.push(flagSpec);
      continue;
    }

    for (const ch of flagSpec) {
      if (SUPPORTED_INLINE_FLAGS.has(ch)) {
        supported.add(ch);
      } else {
        droppedFlags.push(ch);
      }
    }
  }

  return {
    pattern: remaining,
    flags: [...supported].join(""),
    normalized,
    droppedFlags,
  };
}

/**
 * Compile a pattern from external/LLM source into a `RegExp`. Returns
 * `undefined` on failure rather than throwing — callers that depend on
 * the regex should treat `undefined` as "rule not applicable" and fall
 * through to default behavior (e.g. use the full text rather than
 * narrowing to a section).
 *
 * The optional `onError` callback is fired once per unique failure so
 * surrounding logging stays in the caller's control (NestJS Logger
 * context, source URL, etc.).
 */
export function safeRegex(
  rawPattern: string,
  defaultFlags = "",
  onError?: (err: Error, prepared: PreparedPattern) => void,
): RegExp | undefined {
  if (!rawPattern) return undefined;
  const prepared = preparePattern(rawPattern, defaultFlags);
  try {
    return new RegExp(prepared.pattern, prepared.flags);
  } catch (err) {
    onError?.(err as Error, prepared);
    return undefined;
  }
}

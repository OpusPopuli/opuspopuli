/**
 * JSON salvage helpers for LLM responses.
 *
 * Mirrors the recovery strategy used by the propositions / bio AI generators
 * (see apps/backend/.../llm-json-salvage.util.ts) so the scraping pipeline's
 * PDF handler doesn't have to round-trip through the backend package. Both
 * paths face the same failure mode: qwen3.5:9b occasionally truncates at
 * the token ceiling or drops a closing quote, leaving JSON that JSON.parse
 * rejects but a balanced-brace scanner can recover.
 *
 * This module exposes only the tier-1 "extract first balanced {…} object"
 * helper. The bio-generator's tier-2 char-by-char single-field extractor
 * isn't needed here because TextExtractionRuleSet has many fields and
 * partial recovery would be misleading.
 */

const LEADING_CODE_FENCE = /^```(?:json)?\n?/;
const TRAILING_CODE_FENCE = /\n?```$/;

interface JsonScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

/**
 * Pull a JSON object slice out of raw LLM text. Strips ``` code fences,
 * then scans for the first balanced `{…}` block — correctly skipping
 * braces that appear inside JSON string values. Tolerates prose before
 * AND after the JSON object.
 *
 * Returns the candidate string for the caller to `JSON.parse`, or
 * `undefined` if no balanced object is found.
 */
export function extractJsonObjectSlice(text: string): string | undefined {
  const trimmed = stripCodeFences(text.trim());
  const start = trimmed.indexOf("{");
  if (start < 0) return undefined;
  return sliceBalancedObject(trimmed, start);
}

/**
 * Strip leading ```json (or ```) and trailing ``` markdown fences from an
 * LLM response. Exposed so callers that already have a JSON-only string
 * can run the fast `JSON.parse` path on a cleaned input before falling
 * through to {@link extractJsonObjectSlice} (which strips internally).
 */
export function stripCodeFences(text: string): string {
  return text.startsWith("```")
    ? text.replace(LEADING_CODE_FENCE, "").replace(TRAILING_CODE_FENCE, "")
    : text;
}

function sliceBalancedObject(text: string, start: number): string | undefined {
  const state: JsonScanState = { depth: 0, inString: false, escaped: false };
  for (let i = start; i < text.length; i++) {
    if (advanceJsonState(state, text[i]) && state.depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function advanceJsonState(state: JsonScanState, ch: string): boolean {
  if (state.escaped) {
    state.escaped = false;
    return false;
  }
  if (ch === "\\") {
    state.escaped = true;
    return false;
  }
  if (ch === '"') {
    state.inString = !state.inString;
    return false;
  }
  if (state.inString) return false;
  if (ch === "{") state.depth++;
  else if (ch === "}") {
    state.depth--;
    return true;
  }
  return false;
}

/**
 * JSON salvage helpers for LLM responses.
 *
 * LLMs occasionally emit malformed JSON — truncation at the token
 * ceiling, rogue escape sequences, trailing prose. The bio and
 * committee-summary generators share a two-tier recovery strategy:
 *
 *   Tier 1 — full JSON parse of the first balanced {…} block.
 *   Tier 2 — char-by-char extraction of a single string field value,
 *            salvaging useful output when the full parse fails.
 *
 * Both generators need the same balanced-brace scanner and the same
 * escape-aware string extractor, just for different field names.
 * Keeping them here avoids copy-paste drift.
 */

/** Strips leading ```json (or ```) markdown fences from an LLM response. */
const LEADING_CODE_FENCE = /^```(?:json)?\n?/;
/** Strips the trailing ``` fence. */
const TRAILING_CODE_FENCE = /\n?```$/;

interface JsonScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

/**
 * Pull a JSON object slice out of raw LLM text. Strips code fences,
 * then scans for the first balanced `{…}` block — correctly skipping
 * braces that appear inside JSON string values. Tolerates prose
 * before AND after the JSON object.
 */
export function extractJsonObjectSlice(text: string): string | undefined {
  const trimmed = stripCodeFences(text.trim());
  const start = trimmed.indexOf('{');
  if (start < 0) return undefined;
  return sliceBalancedObject(trimmed, start);
}

function stripCodeFences(text: string): string {
  return text.startsWith('```')
    ? text.replace(LEADING_CODE_FENCE, '').replace(TRAILING_CODE_FENCE, '')
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
  if (ch === '\\') {
    state.escaped = true;
    return false;
  }
  if (ch === '"') {
    state.inString = !state.inString;
    return false;
  }
  if (state.inString) return false;
  if (ch === '{') state.depth++;
  else if (ch === '}') {
    state.depth--;
    return true;
  }
  return false;
}

/**
 * Extract the value of `"<fieldName>": "…"` from raw LLM text using a
 * char-by-char scan that handles JSON escape sequences. Used when the
 * surrounding JSON is malformed or truncated but the field's own
 * closing quote was emitted. Returns undefined if the field isn't
 * found or the extracted value is too short to be useful.
 *
 * @param minSalvageLength — reject truncated values shorter than this
 *   when the closing quote was never emitted. Full-quoted values are
 *   returned regardless of length.
 */
export function extractFieldString(
  text: string,
  fieldName: string,
  minSalvageLength = 40,
): string | undefined {
  const opener = new RegExp(`"${fieldName}"\\s*:\\s*"`);
  const match = opener.exec(text);
  if (match?.index === undefined) return undefined;

  const start = match.index + match[0].length;
  let out = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      out += decodeEscapedChar(ch);
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      return out.trim();
    }
    out += ch;
  }
  const trimmed = out.trim();
  return trimmed.length > minSalvageLength ? trimmed : undefined;
}

function decodeEscapedChar(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    default:
      return ch;
  }
}

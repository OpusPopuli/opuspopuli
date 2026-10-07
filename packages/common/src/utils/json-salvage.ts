/**
 * JSON salvage helpers for LLM responses.
 *
 * LLMs occasionally emit malformed JSON — truncation at the token
 * ceiling, rogue escape sequences, trailing prose. Callers share a
 * two-tier recovery strategy:
 *
 *   Tier 1 — full JSON parse of the first balanced {…} block.
 *   Tier 2 — char-by-char extraction of a single string field value,
 *            salvaging useful output when the full parse fails.
 *
 * Tier 2 is most useful when only one field of the object matters
 * (e.g. a generated bio or summary). Skip it for multi-field schemas
 * where partial recovery would be misleading.
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

/**
 * Escape double quotes that appear INSIDE a JSON string value, which is the
 * one malformation that discards an otherwise complete response.
 *
 * Measured on the 2026-10-06 civics sync: the SoS referendum page extracted
 * 22,162 characters of correct content and was thrown away whole, because the
 * page says `referred to as a "full check."` and the model reproduced those
 * inner quotes verbatim and unescaped:
 *
 *     "verbatim": "… referred to as a "full check.""
 *
 * {@link extractJsonObjectSlice} tracks string state, so the stray quote flips
 * `inString`, brace counting desynchronises, no balanced object is ever found,
 * and the page fails. A `verbatim` field is the likeliest place for this to
 * happen, because its whole job is to quote the page.
 *
 * The rule: a `"` inside a string closes it only when the next non-space
 * character is a JSON delimiter (`,` `}` `]` `:`) or end of input. Any other
 * `"` is content, and gets escaped. That is a heuristic, not a parser — it
 * cannot rescue arbitrary malformation, and deliberately leaves truncation and
 * rogue escapes to the tiers above. It is also idempotent on valid JSON, which
 * is what makes it safe to try before giving up.
 *
 * Returns the repaired text, or the input unchanged when nothing needed fixing.
 */
/**
 * How far to the next character that is not whitespace — shared because both
 * repairs decide by looking at what FOLLOWS a candidate character.
 */
function nextMeaningful(text: string, from: number): string | undefined {
  let j = from;
  while (j < text.length && /\s/.test(text[j])) j++;
  return j < text.length ? text[j] : undefined;
}

/**
 * One pass over JSON-ish text, tracking escape and in-string state, with the
 * per-character decision selected by `mode`.
 *
 * The two repairs need byte-identical state tracking and differ only in what
 * they do when they reach their candidate character. Writing that loop twice
 * tripped the duplication gate on push — correctly, since the escape handling
 * is exactly the part that must not drift between them.
 */
function rewriteJson(text: string, mode: "quotes" | "commas"): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  let changes = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out.push(ch);
      escaped = true;
      continue;
    }

    if (mode === "quotes") {
      if (ch !== '"') {
        out.push(ch);
        continue;
      }
      if (!inString) {
        inString = true;
        out.push(ch);
        continue;
      }
      // Inside a string: this quote closes it only if a JSON delimiter
      // follows. Anything else means it is content.
      const next = nextMeaningful(text, i + 1);
      if (
        next === undefined ||
        next === "," ||
        next === "}" ||
        next === "]" ||
        next === ":"
      ) {
        inString = false;
        out.push(ch);
      } else {
        out.push('\\"');
        changes++;
      }
      continue;
    }

    // mode === "commas"
    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }
    if (inString || ch !== ",") {
      out.push(ch);
      continue;
    }
    const next = nextMeaningful(text, i + 1);
    if (next === "}" || next === "]") {
      changes++; // drop it, keeping the whitespace that follows
    } else {
      out.push(ch);
    }
  }

  return changes === 0 ? text : out.join("");
}

export function repairUnescapedQuotes(text: string): string {
  return rewriteJson(text, "quotes");
}

/**
 * Remove a comma that sits immediately before a closing brace or bracket.
 *
 * The second malformation class measured on the civics corpus, and a separate
 * one from {@link repairUnescapedQuotes} — which is why it is a separate
 * function rather than more behaviour hidden behind that name.
 *
 * Measured 2026-10-06 on the SoS referendum page under civics prompt v6:
 *
 *     "...qualifies for the following general election instead.",
 *     },
 *
 * `Illegal trailing comma before end of object` at char 12890. Worth noting
 * where it appeared: v5 failed on unescaped quotes at position 10116, and once
 * v6 fixed those the failure moved PAST it to 12898. The defect was always
 * there, hidden behind an earlier one.
 *
 * JSON forbids this; every mainstream language that borrows JSON's syntax
 * allows it, so a model trained on code emits it. Dropping the comma changes
 * no value and loses no content, which makes this the safest repair in the
 * module — safer than the quote repair, which has to guess whether a quote
 * terminates a string.
 *
 * String-aware: a comma inside a string value is content and stays. Returns
 * the input unchanged when there is nothing to remove, so it is free to run
 * speculatively and idempotent on valid JSON.
 */
export function repairTrailingCommas(text: string): string {
  return rewriteJson(text, "commas");
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
  let out = "";
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      out += decodeEscapedChar(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
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
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    default:
      return ch;
  }
}

/** Which repair classes a successful salvage had to apply, in order. */
export type JsonRepairClass = "quotes" | "commas";

export interface RepairedJson {
  /** The parsed value. */
  value: unknown;
  /**
   * Empty when the text parsed as-is. Non-empty names exactly what the
   * producer got wrong, which is the part worth logging — the caller should
   * not have to diff the strings itself to find out.
   */
  applied: JsonRepairClass[];
  /** Character count after repair, for the caller's log line. */
  repairedChars: number;
}

/**
 * Parse JSON, repairing the two malformations that are both common in model
 * output and fully recoverable, and reporting which ones fired.
 *
 * Both repairs are applied together because they are independent and one
 * response can carry both. Measured on the same civics page in sequence:
 * prompt v5 failed on unescaped quotes at position 10116, and once v6 fixed
 * those the failure moved PAST it to 12898 — an illegal trailing comma that
 * had been hidden behind the first defect all along. Attempting only one
 * repair per call would have needed a second round trip to find that.
 *
 * Returns `undefined` when the text is not salvageable, leaving the caller to
 * report the ORIGINAL parse error: that is the one describing what the
 * producer actually emitted, and the post-repair error describes a string
 * nothing ever sent.
 */
export function parseJsonWithRepair(text: string): RepairedJson | undefined {
  try {
    return { value: JSON.parse(text), applied: [], repairedChars: text.length };
  } catch {
    const quoted = repairUnescapedQuotes(text);
    const repaired = repairTrailingCommas(quoted);
    if (repaired === text) return undefined;

    const applied: JsonRepairClass[] = [];
    if (quoted !== text) applied.push("quotes");
    if (repaired !== quoted) applied.push("commas");

    try {
      return {
        value: JSON.parse(repaired),
        applied,
        repairedChars: repaired.length,
      };
    } catch {
      return undefined;
    }
  }
}

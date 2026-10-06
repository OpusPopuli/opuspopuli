/**
 * Ground extracted measure types against the page they came from.
 *
 * Two defects, one rule, both measured on the 2026-10-06 civics sync rather
 * than guessed at. On the SoS "cleared for circulation" page the model emitted
 * five types:
 *
 *   IS     | Initiative Statute                               name ON the page
 *   ICA    | Initiative Constitutional Amendment              name ON the page
 *   ICAAS  | Initiative Constitutional Amendment and Statute  name ON the page
 *   IR     | Referendum                                       NOT on the page
 *   Recall | Recall                                           NOT on the page
 *
 * So three were real but filed under initialisms the page never uses — the
 * model compressing a name it had read in full — and two were invented
 * outright. The merged taxonomy dedups by `code`, so the compression alone
 * splits one classification into two entries across pages.
 *
 * Five attempts to fix this by instruction produced one regression each time:
 * naming the initialisms taught them, describing a compression the page does
 * not contain made the page extract nothing, and removing the paragraph
 * restored extraction along with the initialisms. The model is not the right
 * place to enforce identity. The page is.
 *
 * TWO WARRANTS, not one. The first version of this checked the page text
 * alone and deleted eleven legitimate California measure types from the
 * Assembly legislative-process page — AB, ACA, SCA, ACR, SCR, AJR, SJR, HR,
 * SR — because that source's hint is what instructs them:
 *
 *   "Capture all measure-type abbreviations (AB, SB, ACA, SCA, ACR, SCR,
 *    AJR, SJR, HR, SR) plus high-leverage procedural terms"
 *
 * The gold set has always drawn this distinction (`warrant: 'page' | 'hint'`)
 * and the eval harness prints it on every run: "warrant: page text OR the
 * source's curated hints". docs/evals/2026-09-27-civics-gold.md records the
 * same mistake being made once already — "Scoring a model's output against
 * page text alone marked every one of those as a fabrication, which is how
 * this eval's first run got the answer backwards". Repeating it inside the
 * pipeline is worse than in a scorer, because here it deletes.
 *
 * The rule:
 *
 *   name warranted  -> canonical. Use the NAME as the code, so the same
 *                      classification arrives under one identity from every
 *                      page that names it.
 *   code warranted  -> keep as-is. Legitimate abbreviations exist: the
 *                      Assembly glossary DEFINES AB, ACA, ACR, AJR, and the
 *                      source hints instruct the full set.
 *   neither         -> drop. Nothing the model was given supports the claim.
 *
 * "Warranted" means present in the page text OR in the source's own
 * contentGoal + hints. A config author instructing a vocabulary is evidence;
 * only a claim supported by neither is invention.
 *
 * Deliberately narrow: `measureTypes` only, which is where the defect was
 * measured. Lifecycle stages have their own documented naming problem and a
 * different shape of evidence; widening this without measuring that would be
 * the same mistake in a new field.
 */

/** The subset of a measure type this cares about. */
interface GroundableType {
  code?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

export interface GroundingResult<T> {
  /** Types that survived, with codes canonicalised where the name grounded. */
  types: T[];
  /** `code -> name` for each type whose code was replaced by its name. */
  canonicalised: { from: string; to: string; warrant: 'page' | 'hint' }[];
  /** Codes dropped — supported by neither the page nor the source's hints. */
  dropped: string[];
  /**
   * Duplicate entries collapsed, by final code. Measured 2026-10-06: the
   * Assembly glossary page emitted `Assembly Joint Resolution` and
   * `Senate Joint Resolution` THIRTEEN times each, byte-identical (13 copies,
   * 1 distinct JSON, 712 chars every time), which is what made `AJR` look
   * like it spanned 16 pages in the merged taxonomy when it spanned one.
   */
  duplicatesRemoved: number;
  /**
   * Codes whose duplicates were NOT identical. Collapsing keeps the first,
   * which is lossless when copies agree and a judgement when they do not —
   * so the disagreement is surfaced rather than silently resolved.
   */
  conflicting: string[];
}

/** Case-insensitive substring presence. Names are phrases, so no word bounds. */
function phraseOnPage(page: string, phrase: string): boolean {
  return phrase.length > 0 && page.includes(phrase.toLowerCase());
}

/**
 * Whole-token presence, so `AB` does not match inside `ABOUT`.
 *
 * Case-sensitive for an all-caps code, which the first version of this got
 * wrong and its own test caught: matching case-insensitively, the code `IS`
 * matched the English word "is" and a fabricated Initiative Statute would
 * have been waved through on almost any page. An initialism that a page
 * genuinely uses is written in capitals there — the Assembly glossary lists
 * `AB - Assembly Bill` — so requiring the case is both stricter and truer to
 * how these appear. Mixed-case codes keep the lenient comparison, since a
 * word-shaped code like `Recall` is not relying on capitalisation to mean
 * what it says.
 */
function tokenOnPage(
  rawPage: string,
  lowerPage: string,
  token: string,
): boolean {
  if (!token) return false;
  const isInitialism = token.length >= 2 && token === token.toUpperCase();
  const haystack = isInitialism ? rawPage : lowerPage;
  const needle = isInitialism ? token : token.toLowerCase();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(
    haystack,
  );
}

export function groundMeasureTypes<T extends GroundableType>(
  types: readonly T[] | undefined,
  pageText: string,
  /**
   * The source's contentGoal + hints, flattened. Optional so a caller with no
   * config still gets page-only grounding, but the pipeline always passes it —
   * omitting it is what deleted eleven real types.
   */
  hintsText = '',
): GroundingResult<T> {
  const result: GroundingResult<T> = {
    types: [],
    canonicalised: [],
    dropped: [],
    duplicatesRemoved: 0,
    conflicting: [],
  };
  if (!Array.isArray(types)) return result;

  const lowerPage = pageText.toLowerCase();
  const lowerHints = hintsText.toLowerCase();

  for (const type of types) {
    const code = typeof type.code === 'string' ? type.code.trim() : '';
    const name = typeof type.name === 'string' ? type.name.trim() : '';

    // Prefer the page as the warrant when both have it — it is the stronger
    // evidence, and the distinction is worth logging.
    const nameWarrant = !name
      ? undefined
      : phraseOnPage(lowerPage, name)
        ? ('page' as const)
        : phraseOnPage(lowerHints, name)
          ? ('hint' as const)
          : undefined;

    if (nameWarrant) {
      if (code !== name) {
        result.canonicalised.push({
          from: code || '<none>',
          to: name,
          warrant: nameWarrant,
        });
      }
      result.types.push({ ...type, code: name });
      continue;
    }

    if (
      code &&
      (tokenOnPage(pageText, lowerPage, code) ||
        tokenOnPage(hintsText, lowerHints, code))
    ) {
      result.types.push(type);
      continue;
    }

    result.dropped.push(code || name || '<unnamed>');
  }

  // Collapse duplicates by FINAL code — only possible after canonicalisation,
  // since `AJR` and `Assembly Joint Resolution` are the same type and do not
  // look it until both are canonical. First occurrence wins: lossless when the
  // copies agree, which is what was measured, and flagged when they do not.
  const seen = new Map<string, string>();
  const deduped: T[] = [];
  for (const type of result.types) {
    const key =
      typeof type.code === 'string' ? type.code : JSON.stringify(type.code);
    const serialised = JSON.stringify(type);
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, serialised);
      deduped.push(type);
      continue;
    }
    result.duplicatesRemoved++;
    if (previous !== serialised && !result.conflicting.includes(key)) {
      result.conflicting.push(key);
    }
  }
  result.types = deduped;

  return result;
}

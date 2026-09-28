/**
 * Score a civics extraction against the gold set.
 *
 * Follows `scoring/omission.ts`: pure, with similarity injected, so the scoring
 * rules are testable without a model or an embedder.
 *
 * ## Four measures, never merged into one
 *
 * A single score cannot distinguish the failures civics extraction actually has,
 * and they have different fixes. On 2026-09-24 one byte-count diff reported 23%
 * for a page where nemotron had both produced better stage NAMES and dropped two
 * descriptive fields from every stage — two opposite findings, one number.
 *
 *   recall        of the gold items, how many did the model produce?
 *   precision     of what it produced, how much is warranted (page or hints)?
 *   fieldPresence did a field with gold content come back empty?
 *   invention     on a field whose correct answer is EMPTY, did it produce anything?
 *
 * ## Why precision is grounding, not similarity — and what counts as warrant
 *
 * Recall needs fuzzy matching — a gold item phrased differently is still
 * recalled. Precision does not: an emitted item is supported if its VERBATIM text
 * appears in its warrant. Cheap, needs no embedder, and auditable.
 *
 * A claim has TWO legitimate warrants, and missing the second invalidated this
 * scorer's first run (2026-09-27):
 *
 *   page   the extracted page text
 *   hint   the data source's curated `hints` and `contentGoal` from the region
 *          config, which are part of the prompt
 *
 * The California Secretary of State source instructs the model outright —
 * "measureTypes here are DIRECT-DEMOCRACY measures — Initiative Statute,
 * Initiative Constitutional Amendment, Referendum, Recall" and "use distinct
 * kebab-case ids such as 'signature-gathering', 'signature-verification',
 * 'qualified-for-ballot', 'general-election-vote'". Scoring only against page
 * text marked all of those as fabrications when the config had DEMANDED them,
 * which flatters whichever model ignores its instructions.
 *
 * Human-authored config is arguably the stronger warrant of the two. What
 * remains a real failure is a claim supported by NEITHER.
 *
 * The civics schema stores `{verbatim, plainLanguage}` pairs, and only the
 * verbatim half is a claim about the page. `plainLanguage` is an AI rewrite and is
 * deliberately exempt — scoring it as ungrounded would penalise the feature.
 *
 * ## Why invention is scored separately from precision
 *
 * A page whose correct answer is "nothing" cannot have precision measured: there
 * is nothing to be right about, and 0/0 is not 100%. `teachers-and-students` is
 * a directory of links from which qwen produced 15,566 bytes. Without scoring
 * that as its own failure, an eval rewards only finding things — and qwen's
 * invention outscores a correct abstention.
 */

export interface GoldCivicsItem {
  id: string;
  text: string;
  essential?: boolean;
  /** Verbatim substring of the source text. Authored, and test-verified. */
  evidence?: string;
}

export interface GoldCivicsField {
  expected: "empty" | "non-empty";
  items?: GoldCivicsItem[];
  /** Marks a field whose correct answer is empty AND that a model tends to fill. */
  trap?: boolean;
  /**
   * This field's claims must come from THIS page — a hint naming them is not
   * enough.
   *
   * Some fields are region-level vocabularies: California really does instruct
   * that its ballot measures include `Recall`, so a `measureTypes` entry taken
   * from the config is the extractor obeying its configuration. `lifecycleStages`
   * on a direct-democracy page is not like that. The Secretary of State splits
   * one process across several pages — circulation on one, eligibility on
   * another, failure on a third — so a stage lifted from the hint's description
   * of a DIFFERENT page's segment is wrong here, however real it is elsewhere.
   *
   * Without this distinction, enriching a hint raises precision mechanically:
   * every claim it names becomes warranted. Measured — the rewritten SoS hint
   * took `lifecycleStages` precision to 1.00 while 3 of 5 claims on
   * `failed-qualify` were stages that page never mentions.
   */
  pageOnly?: boolean;
}

/** One thing a candidate emitted for a field, flattened for scoring. */
export interface EmittedItem {
  /** The claim about the page — the `verbatim` half, never `plainLanguage`. */
  verbatim: string;
  /** Sub-fields present on this item, for the depth measure. */
  subFields?: string[];
}

export interface ItemRecall {
  id: string;
  text: string;
  essential: boolean;
  recalled: boolean;
  bestScore: number;
  matchedTo?: string;
}

/** Where an emitted claim's support came from, or null if it had none. */
export type Warrant = "page" | "hint" | null;

/** An emitted claim and the warrant the scorer found for it. */
export interface EmittedWarrant {
  verbatim: string;
  warrant: Warrant;
}

export interface FieldScore {
  field: string;
  expected: "empty" | "non-empty";
  /** Recall over gold items. Undefined when the field expects empty. */
  recall?: number;
  essentialRecall?: number;
  items: ItemRecall[];
  /** Emitted items warranted by NEITHER the page nor the hints. */
  ungrounded: string[];
  /**
   * EVERY emitted claim with how it was warranted. Recorded because a recall-0
   * field cannot be diagnosed from its score: `lifecycleStages` scoring 0 with
   * four items emitted and precision 0.75 is a different bug depending on
   * whether those four were paraphrases of the gold, stages from another page,
   * or — as it turned out — the kebab-case example ids out of the region hints.
   */
  emitted: EmittedWarrant[];
  /** How the grounded ones were warranted — config-driven vs read off the page. */
  warrantedByPage: number;
  warrantedByHint: number;
  /**
   * Claims the hints warrant but the page does not, on a `pageOnly` field.
   * Counted as precision errors there, and always reported separately: they are
   * a different mistake from inventing something, and a different mistake from
   * correctly following configuration.
   */
  offPage: string[];
  emittedCount: number;
  /** Share of emitted items supported by the source. Undefined if none emitted. */
  precision?: number;
  /** A gold-bearing field that came back empty. */
  wentEmpty: boolean;
  /** An empty-expected field that was filled. Counted, not rationalised. */
  invented: number;
}

export type Similarity = (goldIndex: number, emittedIndex: number) => number;

/**
 * Recall similarity: containment over CONTENT tokens.
 *
 * Gold items are phrased as descriptions ("Qualified for the ballot — becomes
 * qualified on the 131st day before the general election") while a model emits a
 * label ("Qualified for Ballot"), so containment either way is the right shape.
 *
 * It must ignore function words for the same reason `warrantFor` does, and the
 * cost of not doing so was measured: prompt v3 emitted "Qualified for Ballot" and
 * v4 emitted "Qualified for **the** Ballot", and a whitespace-only containment
 * check scored those 0 and 0.8 — across the 0.6 threshold, so one dropped article
 * moved a page's recall from 0.50 to 0.75 while the model's behaviour was
 * IDENTICAL. A measure that swings on an article cannot be used to judge a prompt.
 *
 * Deliberately still not stemming: "signature gathering" does not match the
 * page's "circulation period ... gather signatures". Those are different stage
 * names, and crediting one for the other is how a recitation of the config's
 * example ids would pass as a reading of the page.
 */
export function containmentSimilarity(
  goldTexts: string[],
  emittedTexts: string[],
): Similarity {
  const g = goldTexts.map(contentTokens);
  const e = emittedTexts.map(contentTokens);
  // Gold items are written "Name — what it is", so the NAME is what a model is
  // expected to emit and the gloss is context for a human reader. Comparing whole
  // strings made a correct answer score 0: gold "Policy committee — assigned by the
  // Rules Committee, not heard until 30 days after introduction" against the page's
  // own heading "What To Do When Your Bill Goes To Policy Committee" shares neither
  // containment direction, though a reader would call that found.
  //
  // Only heads with TWO OR MORE content tokens are used. A one-word head would
  // match anything containing that word — a bare "Governor" would be credited by
  // "You Can Still Act After Your Bill Goes To The Governor", and by any other
  // sentence mentioning the Governor at all.
  const heads = goldTexts.map((t) => {
    const head = contentTokens(t.split(/[—–]|\s-\s/)[0]);
    return head.length >= 2 ? head : undefined;
  });
  const subset = (a: string[], b: string[]) => {
    const bag = new Set(b);
    return a.length > 0 && a.every((t) => bag.has(t));
  };
  return (gi, ei) => {
    const a = g[gi];
    const b = e[ei];
    if (!a?.length || !b?.length) return 0;
    if (a.length === b.length && subset(a, b) && subset(b, a)) return 1;
    if (subset(b, a) || subset(a, b)) return 0.8;
    // Fall back to the gold's name alone, scored lower: the model named the right
    // thing without carrying the detail the gold records.
    const head = heads[gi];
    return head && subset(head, b) ? 0.7 : 0;
  };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What warrants an emitted claim?
 *
 * Substring after whitespace normalisation, against the page first and the
 * source's hints second. Deliberately strict: the question is whether the model
 * copied something that is actually there, not whether something similar is. A
 * paraphrase counts for RECALL, never for warrant.
 */

/**
 * Function words that a model may add or drop without changing what it claimed.
 *
 * Kept deliberately tiny. This is not stemming or synonymy — it is the gap
 * between "Qualified for Ballot" and the page's "qualified for the ballot",
 * which strict substring matching scored as a FABRICATION. Two of the three
 * apparent fabrications across the first two runs were this, so the instrument
 * was the larger error term, not the model.
 */
const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "that",
  "this",
  "with",
  "from",
]);

const contentTokens = (s: string): string[] =>
  norm(s)
    .replace(/[^\p{L}\p{N}\s,%$.-]/gu, " ")
    .split(/\s+/)
    // Punctuation is kept INSIDE a token ("546,651", "25%", "gut-and-amend") and
    // stripped from its edges. Without the strip, a gold description's
    // "Initiative Statute, requiring 546,651 signatures" tokenises "statute,"
    // and an emitted "Initiative Statute" fails to match it — which silently
    // took measureTypes recall on failed-qualify from 1.00 to 0.
    .map((t) => t.replace(/^[.,-]+/, "").replace(/[.,-]+$/, ""))
    .filter((t) => t && !FUNCTION_WORDS.has(t));

/**
 * Warrant by CONTENT TOKENS, not by substring.
 *
 * A claim is warranted when every content-bearing token of it appears in the
 * warrant text. That keeps the check lexical — it still asks "did the model copy
 * something that is actually there", and "Recall" against a page that never says
 * it still fails — while tolerating the function words a model adds or drops.
 *
 * Deliberately NOT embedding similarity. Recall is the measure where paraphrase
 * should count; warrant is the measure that catches invention, and a semantic
 * threshold there would let a plausible-sounding fabrication through, which is
 * the one thing this eval exists to detect.
 *
 * Exact substring is still tried first, so a verbatim copy is recognised as such
 * without tokenising.
 */
export function warrantFor(
  verbatim: string,
  sourceText: string,
  hintsText = "",
): Warrant {
  const v = norm(verbatim);
  if (v.length < 4) return null; // too short to be evidence of anything

  const page = norm(sourceText);
  const hints = norm(hintsText);
  if (page.includes(v)) return "page";
  if (hints && hints.includes(v)) return "hint";

  const tokens = contentTokens(verbatim);
  // A claim with no content tokens at all is function words only — not evidence.
  if (tokens.length === 0) return null;
  // PAGE gets the lenient in-order rule: the model read prose and may compress
  // or rephrase it, so "Qualified for Ballot" should match "qualified for the
  // ballot".
  if (appearsTogether(tokens, sourceText)) return "page";

  // HINTS get a STRICT rule — literal substring only, checked above. A hint is an
  // instruction the model copies, not prose it paraphrases: when the config names
  // a measure type it names it exactly ("Referendum, Recall"). Applying the
  // lenient rule here warranted "Assembly Bill" off the Assembly source's
  // sentence "...CA Assembly description of how a bill becomes law" — an
  // accidental in-order pair in 6,000 characters of instructional prose, which
  // excused an invented measure type on a page of links.
  return null;
}

/**
 * Do the claim's content tokens appear IN ORDER and close together?
 *
 * Order is the discriminator, and it took two wrong rules to find that out:
 *
 *   substring only      rejected "Qualified for Ballot" against a page saying
 *                       "qualified for the ballot" — a fabrication verdict on a
 *                       dropped "the"
 *   token set, windowed warranted "Assembly Bill" on a page of links, because it
 *                       says "...becomes a bill..." and then "Contact Your
 *                       Assembly Representative" six words later. Unrelated
 *                       mentions, and the measure type was invented
 *
 * In-order matching separates them cleanly: the page has `bill` BEFORE
 * `assembly`, so "Assembly Bill" is not a quote from it, while "eligible
 * initiative measure signatures verified" does run in order through one sentence.
 *
 * Still lexical, deliberately. No stemming and no synonymy — "signature" does not
 * match "signatures", which costs one false fabrication on the qwen baseline and
 * is the documented price of a warrant check that a fabrication cannot talk its
 * way past. Recall is the measure where meaning counts.
 */
function appearsTogether(tokens: string[], hay: string): boolean {
  const stream = contentTokens(hay);
  if (stream.length === 0 || tokens.length === 0) return false;

  // Slack above the claim's own length: enough for the function words the
  // tokeniser dropped and a little rewording, not enough to span a page.
  const window = tokens.length * 2 + 4;

  for (let start = 0; start < stream.length; start++) {
    if (stream[start] !== tokens[0]) continue;
    let ti = 1;
    for (let i = start + 1; i < Math.min(start + window, stream.length); i++) {
      if (stream[i] === tokens[ti]) ti++;
      if (ti === tokens.length) return true;
    }
    if (tokens.length === 1) return true;
  }
  return false;
}

/** Retained for callers that have no hints to offer. */
export function isGrounded(
  verbatim: string,
  sourceText: string,
  hintsText = "",
): boolean {
  return warrantFor(verbatim, sourceText, hintsText) !== null;
}

export function scoreField(
  field: string,
  gold: GoldCivicsField,
  emitted: EmittedItem[],
  sourceText: string,
  similarity: Similarity,
  threshold: number,
  hintsText = "",
): FieldScore {
  const goldItems = gold.items ?? [];

  const items: ItemRecall[] = goldItems.map((g, gi) => {
    let bestScore = 0;
    let bestIndex = -1;
    for (let ei = 0; ei < emitted.length; ei++) {
      const s = similarity(gi, ei);
      if (s > bestScore) {
        bestScore = s;
        bestIndex = ei;
      }
    }
    const recalled = bestScore >= threshold;
    return {
      id: g.id,
      text: g.text,
      essential: g.essential ?? false,
      recalled,
      bestScore: Number(bestScore.toFixed(3)),
      ...(recalled && bestIndex >= 0
        ? { matchedTo: emitted[bestIndex].verbatim.slice(0, 80) }
        : {}),
    };
  });

  const warrants = emitted.map((e) => ({
    verbatim: e.verbatim,
    warrant: warrantFor(e.verbatim, sourceText, hintsText),
  }));
  const ungrounded = warrants
    .filter((w) => w.warrant === null)
    .map((w) => w.verbatim.slice(0, 80));
  const offPage = gold.pageOnly
    ? warrants
        .filter((w) => w.warrant === "hint")
        .map((w) => w.verbatim.slice(0, 80))
    : [];
  const unsupported = ungrounded.length + offPage.length;

  const essential = items.filter((i) => i.essential);
  const recalledCount = items.filter((i) => i.recalled).length;

  return {
    field,
    expected: gold.expected,
    ...(goldItems.length
      ? {
          recall: Number((recalledCount / goldItems.length).toFixed(3)),
          essentialRecall: essential.length
            ? Number(
                (
                  essential.filter((i) => i.recalled).length / essential.length
                ).toFixed(3),
              )
            : undefined,
        }
      : {}),
    items,
    ungrounded,
    offPage,
    emitted: warrants.map((w) => ({
      verbatim: w.verbatim.slice(0, 80),
      warrant: w.warrant,
    })),
    warrantedByPage: warrants.filter((w) => w.warrant === "page").length,
    warrantedByHint: warrants.filter((w) => w.warrant === "hint").length,
    emittedCount: emitted.length,
    ...(emitted.length
      ? {
          precision: Number(
            ((emitted.length - unsupported) / emitted.length).toFixed(3),
          ),
        }
      : {}),
    wentEmpty: gold.expected === "non-empty" && emitted.length === 0,
    invented: gold.expected === "empty" ? emitted.length : 0,
  };
}

export interface PageVerdict {
  fields: FieldScore[];
  /** Fields with gold content that returned nothing — the loudest failure. */
  emptied: string[];
  /** Fields that should have been empty and were not. */
  invented: string[];
  /** Emitted claims absent from the source, across all fields. */
  ungroundedCount: number;
  /** Claims warranted only by hints on a field the gold marks `pageOnly`. */
  offPageCount: number;
  meanRecall?: number;
  meanPrecision?: number;
}

export function summarisePage(fields: FieldScore[]): PageVerdict {
  const withRecall = fields.filter((f) => f.recall !== undefined);
  const withPrecision = fields.filter((f) => f.precision !== undefined);
  const mean = (ns: number[]) =>
    ns.length
      ? Number((ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(3))
      : undefined;

  return {
    fields,
    emptied: fields.filter((f) => f.wentEmpty).map((f) => f.field),
    invented: fields.filter((f) => f.invented > 0).map((f) => f.field),
    ungroundedCount: fields.reduce((n, f) => n + f.ungrounded.length, 0),
    offPageCount: fields.reduce((n, f) => n + f.offPage.length, 0),
    meanRecall: mean(withRecall.map((f) => f.recall as number)),
    meanPrecision: mean(withPrecision.map((f) => f.precision as number)),
  };
}

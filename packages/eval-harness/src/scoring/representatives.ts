/**
 * Scoring for `representatives-eval.ts` (representatives Phase B §4,
 * `docs/plans/representatives-gold-eval.md` D4).
 *
 * Four axes, never merged into one score, reported per rep (n is small —
 * an aggregate over three pages hides which rep moved):
 *
 * | axis           | question                                         |
 * |----------------|--------------------------------------------------|
 * | recall         | of the quotable gold facts, how many were named? |
 * | field presence | did a field with gold content come back empty?   |
 * | precision      | of claims marked `source`, how many are quotable?|
 * | labelling      | are the unquotable claims marked `training`?     |
 *
 * Precision and labelling need text the bio was generated FROM. Until #1381
 * gives the bio prompt a source page, there is none, and they report
 * `exercised: false` rather than a number — a precision of 1.0 over nothing
 * would read as a result.
 */

export interface GoldCommittee {
  name: string;
  role: string;
}

/** Words that name the KIND of committee, not which one. */
const NOISE = new Set([
  "a",
  "an",
  "and",
  "of",
  "on",
  "the",
  "for",
  "in",
  "to",
  "committee",
  "committees",
  "select",
  "joint",
  "standing",
  "subcommittee",
  "no",
]);

/** Lowercased content words, punctuation and committee-kind words dropped. */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !NOISE.has(w));
}

/**
 * Whether `phrase` is named in `text`: every content word of the phrase
 * appears in one sentence of the text. Per sentence, not over the whole
 * text, so "Water" from one sentence and "Wildlife" from another do not
 * add up to a committee nobody named.
 */
export function namedIn(phrase: string, text: string): boolean {
  const words = contentWords(phrase);
  if (words.length === 0) return false;
  return sentences(text).some((sentence) => {
    const bag = new Set(contentWords(sentence));
    return words.every((w) => bag.has(w));
  });
}

/**
 * Words a claim carries that a source page has no reason to: who it is about
 * (the page says "Senator Ashby", the claim "She") and the auxiliaries
 * around the fact. Dropped only when testing a claim — a committee name has
 * none of them.
 */
const CLAIM_NOISE = new Set([
  "she",
  "he",
  "they",
  "her",
  "his",
  "their",
  "is",
  "was",
  "are",
  "were",
  "has",
  "have",
  "had",
  "been",
  "be",
  "as",
  "at",
  "by",
  "with",
  "who",
  "which",
  "that",
]);

/** {@link namedIn} for a claim sentence: the fact's words, not its grammar. */
export function claimQuotable(sentence: string, text: string): boolean {
  const words = contentWords(sentence).filter((w) => !CLAIM_NOISE.has(w));
  if (words.length === 0) return false;
  return sentences(text).some((s) => {
    const bag = new Set(contentWords(s));
    return words.every((w) => bag.has(w));
  });
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.;!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/** A non-Member role is stated on the page and must survive. */
const STATED_ROLE = /^(vice chair|co-chair|chair)$/i;

export interface CommitteeRecall {
  found: number;
  total: number;
  missed: string[];
  /** Gold roles above Member, and whether the summary kept each. */
  roles: { committee: string; role: string; kept: boolean }[];
}

/**
 * Recall over one rep's gold committees, against the summary text.
 *
 * Role fidelity is reported beside recall, not folded into it: "named the
 * committee, dropped the Vice Chair" is a different failure from "missed the
 * committee", and the 2026-10-19 baseline had one without the other.
 */
export function scoreCommittees(
  gold: readonly GoldCommittee[],
  summary: string,
): CommitteeRecall {
  const missed: string[] = [];
  const roles: CommitteeRecall["roles"] = [];
  for (const committee of gold) {
    const found = namedIn(committee.name, summary);
    if (!found) missed.push(committee.name);
    if (STATED_ROLE.test(committee.role)) {
      roles.push({
        committee: committee.name,
        role: committee.role,
        kept: found && namedIn(`${committee.role} ${committee.name}`, summary),
      });
    }
  }
  return {
    found: gold.length - missed.length,
    total: gold.length,
    missed,
    roles,
  };
}

export interface ListRecall {
  found: number;
  total: number;
  missed: string[];
}

/** Recall over a gold list of short facts (counties), against a text. */
export function scoreList(gold: readonly string[], text: string): ListRecall {
  const missed = gold.filter((item) => !namedIn(item, text));
  return { found: gold.length - missed.length, total: gold.length, missed };
}

export interface BioClaim {
  origin?: string;
  sentence?: string;
}

export type LabellingScore =
  | { exercised: false; reason: string }
  | {
      exercised: true;
      sourceClaims: number;
      /** Of the claims marked `source`, how many are quotable. */
      precision: number | null;
      /** Unquotable claims, and how many of them admit it (`training`). */
      unquotable: number;
      honestlyLabelled: number;
    };

/**
 * Precision and labelling for one rep's claims, against the text the bio was
 * generated from. Without that text, not exercised.
 *
 * "Quotable" is {@link claimQuotable}: every content word of the claim, its
 * pronouns and auxiliaries aside, in one sentence of the source. Loose on
 * purpose — a paraphrase of a stated fact is grounded — and the reason the
 * axis is reported with its counts, never as a bare rate.
 */
export function scoreLabelling(
  claims: readonly BioClaim[] | null | undefined,
  sourceText: string | undefined,
): LabellingScore {
  if (!sourceText) {
    return {
      exercised: false,
      reason:
        "the bio is generated from structured fields, not a source page (#1381)",
    };
  }
  const all = (claims ?? []).filter(
    (c): c is Required<BioClaim> =>
      typeof c.sentence === "string" && typeof c.origin === "string",
  );
  const quotable = (c: Required<BioClaim>) =>
    claimQuotable(c.sentence, sourceText);
  const sourced = all.filter((c) => c.origin === "source");
  const unquotable = all.filter((c) => !quotable(c));
  return {
    exercised: true,
    sourceClaims: sourced.length,
    precision:
      sourced.length === 0
        ? null
        : sourced.filter(quotable).length / sourced.length,
    unquotable: unquotable.length,
    honestlyLabelled: unquotable.filter((c) => c.origin === "training").length,
  };
}

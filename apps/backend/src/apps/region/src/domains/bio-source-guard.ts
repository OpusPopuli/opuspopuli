import type { BioClaim } from '@opuspopuli/common';

/** What the guard kept, and what it removed. */
export interface GuardedBio {
  /** The bio with unsupported sentences removed. Empty if none survived. */
  bio: string;
  /** Claims for the surviving sentences only. */
  claims?: BioClaim[];
  /**
   * The sentences that were removed, each with the fact class(es) that
   * triggered it — the operator's only view of what the guard took out, and
   * which class is drifting. A bare sentence list made the log name the wrong
   * class: the first production drop was a term count, reported as a year.
   */
  dropped: DroppedSentence[];
}

/** One removed sentence, and why. */
export interface DroppedSentence {
  sentence: string;
  /** Labels from {@link UNSUPPORTED_ASSERTIONS} that matched unsupported text. */
  reasons: string[];
}

/**
 * Fact classes that are both (a) mechanically detectable in prose and (b)
 * unsupported unless the source data states them.
 *
 * Each pattern is global: every match in a sentence is looked up in the
 * source text, and the sentence survives only if all of them are found. That
 * makes the check self-disabling in the right direction — once a scraped bio
 * supplies "elected in 2024" or "Senate Republican Leader", a sentence
 * repeating it passes, while a sentence asserting a *different* year or post
 * still does not.
 *
 * This is a verification layer over named failure classes, not a proof of
 * groundedness. It is sized to what was actually measured (see
 * {@link dropUnsupportedSentences}); a class that shows up later belongs here
 * rather than in another revision of the prompt.
 */
const UNSUPPORTED_ASSERTIONS: readonly { label: string; pattern: RegExp }[] = [
  // Districts are 1-80, so no collision. A four-digit quantity that is not a
  // year is also a fact four fields cannot support, so treating it as one
  // loses nothing.
  { label: 'year', pattern: /\b(?:1[7-9]\d{2}|20\d{2})\b/g },
  {
    label: 'term count',
    pattern:
      /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+terms?\b/gi,
  },
  {
    label: 'leadership post',
    pattern:
      /\b(?:(?:Senate|Assembly)\s+)?(?:Republican|Democratic|Majority|Minority)\s+Leader\b|\bPresident\s+pro\s+Tem\w*\b|\bSpeaker\s+(?:pro\s+Tem\w*|of\s+the\s+Assembly)\b|\b(?:Majority|Minority)\s+Whip\b/gi,
  },
  {
    label: 'precedence claim',
    pattern:
      /\bfirst\s+(?:woman|women|man|men|female|male|Latina|Latino|Hispanic|Black|African[-\s]American|Asian|Native|Indigenous|Jewish|Muslim|openly\s+\w+|person|Democrat|Republican)\b/gi,
  },
];

/**
 * Tokens that end in a period without ending a sentence. Without this, every
 * initial and honorific splits a sentence in half — and a guard that drops
 * half a sentence is worse than one that drops none.
 */
const ABBREVIATION = new RegExp(
  '(?:' +
    [
      '\\b[A-Z]', // a lone initial: "Jane Q."
      // Honorifics and titles.
      'Mr',
      'Mrs',
      'Ms',
      'Dr',
      'Rev',
      'Hon',
      'Sen',
      'Rep',
      'Gov',
      'Asm',
      'Lt',
      'Col',
      'Gen',
      'Sgt',
      'Capt',
      'Maj',
      // MONTHS. These matter most: they are the tokens that precede a year,
      // so a split here severs exactly the sentence the guard is inspecting —
      // "elected in Nov. 2024 to represent District 7" published as
      // "elected in Nov." with "2024 to represent District 7." dropped.
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Sept',
      'Oct',
      'Nov',
      'Dec',
      // Places and organisations that appear in civic prose.
      'Calif',
      'Ave',
      'Blvd',
      'Rd',
      'Univ',
      'Assn',
      'Dept',
      'Dist',
      'Fed',
      'Natl',
      'Govt',
      'St',
      'Mt',
      'Ft',
      // Generational and corporate.
      'Jr',
      'Sr',
      'Inc',
      'Ltd',
      'Co',
      'Corp',
      // Common prose abbreviations.
      'vs',
      'etc',
      'No',
      'approx',
      'est',
    ].join('|') +
    ')\\.$',
);

/**
 * Remove bio sentences asserting a fact that appears nowhere in the source
 * data (#1381).
 *
 * ── Why this exists in code and not only in the prompt ──────────────────────
 *
 * It is in the prompt too. `document-analysis-representative-bio` v2 states
 * the rule explicitly, with a worked counter-example, and names election
 * years and term counts as the cases that most often go wrong. That revision
 * is what did the heavy lifting: measured on
 * nemotron-3.5-lightning:30b-a3b at the production temperature over 22
 * California legislators, it took training-origin claims from 67-79% of all
 * claims to zero and bios from ~180 words to ~17, eliminating every invented
 * university, employer, prior office, residence city and spouse that v1
 * produced.
 *
 * What it did not stop was the residue: 9 of 22 bios still asserted an
 * election year, and others volunteered a term count, a leadership post, or a
 * "first woman to represent the district" claim. None was recall — Hadwick,
 * Arreguin and Dahle were each elected in 2024 and all three were given 2022;
 * Grove was named current Senate Republican Leader, a post she left in 2022.
 * These are priors the model reaches for when asked for a second sentence
 * about a legislator, and they were emitted tagged `origin: "source"` with a
 * `sourceField` of "Party".
 *
 * So the instruction is necessary but cannot be the enforcement. Production
 * hands this generator four fields — Name, Jurisdiction, District, Party —
 * for 109 of California's 125 legislators, because only 16 Senate pages yield
 * a scrapeable bio and the Assembly's 80 are blocked at TLS. Four fields
 * contain no year, no term count and no leadership post, so for those reps
 * this check is exact rather than heuristic: any such assertion in the output
 * came from somewhere other than the evidence.
 *
 * @param bio - The generated bio, paragraphs separated by blank lines
 * @param sourceText - The exact text handed to the prompt
 * @param claims - Per-sentence attribution, if the response carried any
 * @returns The surviving bio and claims, plus what was dropped
 */
export function dropUnsupportedSentences(
  bio: string,
  sourceText: string,
  claims?: BioClaim[],
): GuardedBio {
  const haystack = sourceText.toLowerCase();
  const dropped: DroppedSentence[] = [];
  const keptParagraphs: string[] = [];

  for (const paragraph of bio.split(/\n\s*\n/)) {
    const kept = splitSentences(paragraph).filter((sentence) => {
      const reasons = unsupportedReasons(sentence, haystack);
      if (reasons.length === 0) return true;
      dropped.push({ sentence: sentence.trim(), reasons });
      return false;
    });

    // Sentences keep their trailing whitespace, so rejoining is lossless.
    const rebuilt = kept.join('').trim();
    if (rebuilt) keptParagraphs.push(rebuilt);
  }

  if (dropped.length === 0) return { bio, claims, dropped };

  const droppedKeys = dropped.map((d) => normalise(d.sentence));
  return {
    bio: keptParagraphs.join('\n\n'),
    claims: claims?.filter((claim) => !isDropped(claim, droppedKeys)),
    dropped,
  };
}

/**
 * Which fact classes in `sentence` assert something the source does not.
 *
 * Matched text is compared rather than the pattern's label, so "elected in
 * 2024" against a source stating 2024 passes while the same sentence
 * claiming 2020 does not. Empty means the sentence is supported.
 *
 * Every class is checked rather than returning on the first — a sentence can
 * be unsupported in more than one way ("serving her first term since 2022"),
 * and the log should say so.
 */
function unsupportedReasons(
  sentence: string,
  lowercaseSource: string,
): string[] {
  const reasons: string[] = [];
  for (const { label, pattern } of UNSUPPORTED_ASSERTIONS) {
    // Shared global regexes carry lastIndex between calls; matchAll does not
    // mutate it, so this stays safe under repeated use.
    for (const [match] of sentence.matchAll(pattern)) {
      if (!lowercaseSource.includes(match.toLowerCase())) {
        reasons.push(label);
        break;
      }
    }
  }
  return reasons;
}

/**
 * Whether a claim attests to a sentence that was removed.
 *
 * CONTAINMENT, not equality. `ABBREVIATION` deliberately merges two
 * sentences rather than risk splitting one, so a dropped entry can be a
 * merged pair while the model's claims are per-sentence — and an equality
 * check then matched neither. Both claims survived into `bio_claims` and the
 * `claims` table, attesting to text no longer in the bio: the #1391 failure
 * class, re-created inside the guard meant to prevent it.
 *
 * Tolerates a claim with no usable `sentence`: the response is model output,
 * `parseBioFromResponse` validates only that `claims` is an array, and a
 * missing field threw a TypeError that discarded an otherwise-good bio.
 */
function isDropped(claim: BioClaim, droppedKeys: string[]): boolean {
  const key = normalise(claim?.sentence ?? '');
  if (!key) return false;
  return droppedKeys.some((dropped) => dropped.includes(key));
}

/** Collapse whitespace so a claim's sentence matches the bio's copy of it. */
function normalise(sentence: string): string {
  return sentence.replaceAll(/\s+/g, ' ').trim();
}

/**
 * Split a paragraph into sentences, each retaining its trailing whitespace.
 *
 * Deliberately conservative: an unrecognised abbreviation leaves two sentences
 * joined, which can only cause the guard to drop a little more than needed.
 * The inverse — splitting mid-sentence — would leave a severed clause in a
 * published bio, so the error is steered to the recoverable side.
 */
function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  const boundary = /[.!?]+["')\]]?\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(paragraph)) !== null) {
    const end = match.index + match[0].length;
    const candidate = paragraph.slice(start, end);
    if (ABBREVIATION.test(candidate.trimEnd())) continue;
    sentences.push(candidate);
    start = end;
  }

  if (start < paragraph.length) sentences.push(paragraph.slice(start));
  return sentences;
}

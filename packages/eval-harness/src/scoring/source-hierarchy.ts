/**
 * Source hierarchy — is the analysis citing law, or citing the proponent?
 *
 * A filed California initiative is not one kind of text. `full_text` runs
 * through at least three zones, and they carry very different authority:
 *
 *   1. **Transmittal** — the proponent's covering letter to the Attorney
 *      General. Enclosure lists, fee cheques, contact details, and often a
 *      "Summary of Measure's Purpose" written by the proponent. **This is not
 *      law and not neutral.** It is one side's description of its own measure.
 *   2. **Findings and declarations** — inside the measure, and enacted with it,
 *      but written to persuade: "California's outdated system for approving
 *      essential projects is too slow, too bureaucratic, and too costly."
 *      Legally operative as legislative intent, rhetorically a campaign
 *      argument.
 *   3. **Operative text** — the sections that amend codes and change what the
 *      law does. What a voter is actually deciding on.
 *
 * A neutral analyst distinguishes "the measure does X" from "the proponents say
 * X". A model that draws a claim about what a measure *does* from the
 * transmittal letter has cited a campaign document as if it were statute — and
 * the citation is what tells a citizen the statement is checkable.
 *
 * This is also the mechanism behind framing leakage. Advocacy wording does not
 * usually arrive from nowhere; it arrives because the model summarised the
 * findings section and adopted its register. Measuring zone attribution gets at
 * the cause rather than the symptom, which is why framing is scored here rather
 * than as a separate word-list.
 *
 * ## Why this is not hand-authored
 *
 * Zones are derived from structural markers in the document, so the metric
 * needs no per-measure gold labels and works on every measure in the corpus.
 * The markers are the same ones the fixture builder uses to find operative
 * text, and the transmittal boundary is the one that matters most: it is the
 * sharpest line, and `25-0012A2` demonstrated the extreme case — a `full_text`
 * that is transmittal letter and nothing else.
 */

export type SourceZone = "transmittal" | "findings" | "operative";

export interface ZoneSpan {
  zone: SourceZone;
  start: number;
  end: number;
}

/** Where the covering letter stops and the measure begins. */
const ENACTMENT =
  /(THE PEOPLE OF THE STATE OF CALIFORNIA DO ENACT|INITIATIVE MEASURE TO BE SUBMITTED DIRECTLY TO THE VOTERS|\bSECTION 1\.|\bSEC\. 1\.)/i;

/**
 * Findings sections announce themselves, and in several spellings. Measured
 * across the corpus: "SEC. 2. Findings.", "Findings and Declarations",
 * "FINDINGS AND PURPOSE", and the bare "The People ... find and declare".
 */
const FINDINGS_START =
  /(SEC(?:TION)?\.?\s*\d+\.?\s*)?(FINDINGS\s+(AND|&)\s+(DECLARATIONS?|PURPOSES?)|FINDINGS\.|find and declare)/i;

/** A numbered section heading — what ends a findings block. */
const SECTION_HEADING = /\bSEC(?:TION)?\.?\s*\d+(\.\d+)?\.\s/gi;

/**
 * Partition a measure into zones.
 *
 * Deliberately conservative: anything that cannot be positively identified as
 * transmittal or findings is called operative. Over-reporting hierarchy errors
 * would be worse than under-reporting them, because the whole point is to be
 * able to say a citation is misattributed and be believed.
 */
export function zoneMap(fullText: string): ZoneSpan[] {
  const len = fullText.length;
  if (len === 0) return [];

  const enact = ENACTMENT.exec(fullText);
  const operativeStart = enact?.index ?? 0;

  const spans: ZoneSpan[] = [];
  if (operativeStart > 0) {
    spans.push({ zone: "transmittal", start: 0, end: operativeStart });
  }

  const body = fullText.slice(operativeStart);
  const findings = FINDINGS_START.exec(body);

  if (!findings) {
    spans.push({ zone: "operative", start: operativeStart, end: len });
    return spans;
  }

  const findingsStart = operativeStart + findings.index;
  if (findingsStart > operativeStart) {
    spans.push({
      zone: "operative",
      start: operativeStart,
      end: findingsStart,
    });
  }

  // The findings block runs until the next numbered section heading after it.
  SECTION_HEADING.lastIndex = findings.index + findings[0].length;
  const next = SECTION_HEADING.exec(body);
  const findingsEnd = next ? operativeStart + next.index : len;

  spans.push({ zone: "findings", start: findingsStart, end: findingsEnd });
  if (findingsEnd < len) {
    spans.push({ zone: "operative", start: findingsEnd, end: len });
  }
  return spans;
}

export function zoneAt(spans: ZoneSpan[], offset: number): SourceZone {
  const hit = spans.find((s) => offset >= s.start && offset < s.end);
  // Unclassifiable offsets count as operative — see the conservatism note.
  return hit?.zone ?? "operative";
}

export interface HierarchyClaim {
  claim: string;
  field: string;
  sourceStart?: number;
  sourceEnd?: number;
}

export interface HierarchyResult {
  claim: string;
  field: string;
  zone: SourceZone;
  /** A claim about what the measure DOES, drawn from a non-operative zone. */
  misattributed: boolean;
}

export interface HierarchyScore {
  results: HierarchyResult[];
  byZone: Record<SourceZone, number>;
  /** Citations into the proponent's covering letter. The worst case. */
  transmittalCitations: number;
  findingsCitations: number;
  misattributed: number;
  scored: number;
  verdict: string;
}

/**
 * Fields that assert what the measure does, as opposed to describing context.
 *
 * `keyProvisions` and `existingVsProposed` are claims about the law. A citation
 * for one of those has to come from operative text; sourcing it from the
 * proponent's letter is the error this metric exists to catch.
 */
const OPERATIVE_FIELDS = new Set([
  "keyProvisions",
  "existingVsProposed.current",
  "existingVsProposed.proposed",
  "fiscalImpact",
]);

export function scoreSourceHierarchy(
  claims: HierarchyClaim[],
  fullText: string,
): HierarchyScore {
  const spans = zoneMap(fullText);
  const byZone: Record<SourceZone, number> = {
    transmittal: 0,
    findings: 0,
    operative: 0,
  };

  const results: HierarchyResult[] = [];
  for (const c of claims) {
    // Only in-range citations can be placed in a zone. An out-of-range offset
    // is an anchoring failure and is counted there, not double-counted here.
    if (
      typeof c.sourceStart !== "number" ||
      c.sourceStart < 0 ||
      c.sourceStart >= fullText.length
    ) {
      continue;
    }
    const zone = zoneAt(spans, c.sourceStart);
    byZone[zone]++;
    results.push({
      claim: c.claim,
      field: c.field,
      zone,
      misattributed: zone !== "operative" && OPERATIVE_FIELDS.has(c.field),
    });
  }

  const misattributed = results.filter((r) => r.misattributed).length;
  return {
    results,
    byZone,
    transmittalCitations: byZone.transmittal,
    findingsCitations: byZone.findings,
    misattributed,
    scored: results.length,
    verdict: describe(results.length, byZone, misattributed),
  };
}

function describe(
  scored: number,
  byZone: Record<SourceZone, number>,
  misattributed: number,
): string {
  if (scored === 0) {
    return "No in-range citations to place — nothing to assess.";
  }

  const parts = [
    `${byZone.operative} operative`,
    `${byZone.findings} findings`,
    `${byZone.transmittal} transmittal`,
  ].join(", ");

  if (byZone.transmittal > 0) {
    return (
      `${byZone.transmittal} of ${scored} citations point into the proponent's ` +
      `COVERING LETTER — a campaign document, not law, cited as the source for ` +
      `an analysis a citizen is told is checkable. (${parts}.)`
    );
  }
  if (misattributed > 0) {
    return (
      `${misattributed} of ${scored} citations source a claim about what the ` +
      `measure DOES from its findings section — enacted, but written to ` +
      `persuade. This is where advocacy wording enters a neutral summary. ` +
      `(${parts}.)`
    );
  }
  return `All ${scored} placed citations fall in operative text. (${parts}.)`;
}

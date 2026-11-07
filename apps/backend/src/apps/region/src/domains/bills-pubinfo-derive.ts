/**
 * Pure pieces of deriving a `bills` row, its co-authors and its votes from the
 * pubinfo mirrors (`docs/plans/bills-phase-b.md`, D10, D15–D17). No database
 * and no clock, so each rule is tested on its own.
 */

/** pubinfo `20252026` → the `2025-2026` label bills already carry. */
export function sessionLabel(sessionYear: string): string {
  return /^\d{8}$/.test(sessionYear)
    ? `${sessionYear.slice(0, 4)}-${sessionYear.slice(4)}`
    : sessionYear;
}

/** `AB` + 1165 → `AB 1165`, the form bills already carry. */
export function billNumber(measureType: string, measureNum: number): string {
  return `${measureType} ${measureNum}`;
}

/**
 * The current version: pubinfo numbers versions downward from 99, so the
 * lowest number is the latest (5,065 of 5,065 bills on 2026-11-05).
 */
export function latestVersion<T extends { versionNum: number }>(
  versions: readonly T[],
): T | undefined {
  let latest: T | undefined;
  for (const v of versions) {
    if (!latest || v.versionNum < latest.versionNum) latest = v;
  }
  return latest;
}

export interface HistoryAction {
  /** `bill_history_id`: digits, assigned in the order actions were recorded. */
  externalId: string;
  actionDate: Date | null;
  action: string | null;
  actionSequence: number | null;
}

/**
 * The bill's last action: newest date, then highest sequence that day, then
 * highest history id. The sequence alone ties (3,434 bills on 2026-11-05,
 * e.g. "From committee: Do pass" and "Read second time" both 11), and the id
 * never orders against it, so without the id the pick followed load order.
 */
export function lastAction<T extends HistoryAction>(
  actions: readonly T[],
): T | undefined {
  let last: T | undefined;
  for (const a of actions) {
    if (!a.actionDate) continue;
    if (!last || isAfter(a, last)) last = a;
  }
  return last;
}

function isAfter(a: HistoryAction, b: HistoryAction): boolean {
  const byDate = a.actionDate!.getTime() - b.actionDate!.getTime();
  if (byDate !== 0) return byDate > 0;
  const bySequence = (a.actionSequence ?? 0) - (b.actionSequence ?? 0);
  if (bySequence !== 0) return bySequence > 0;
  return BigInt(a.externalId) > BigInt(b.externalId);
}

/**
 * The long title ("An act to add …") from a version's CAML text, the string
 * bills.title has always held (D17). Tags inside it are dropped and space
 * collapsed; undefined when the text carries no title.
 */
export function camlTitle(
  billXml: string | null | undefined,
): string | undefined {
  const match = billXml
    ? /<caml:Title>([\s\S]*?)<\/caml:Title>/.exec(billXml)
    : null;
  if (!match) return undefined;
  const title = decodeEntities(match[1].replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return title || undefined;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e]);
}

/** pubinfo vote codes in the vocabulary bill_votes holds (D16). */
const VOTE_POSITIONS: Record<string, string> = {
  AYE: 'yes',
  NOE: 'no',
  // "Absent, abstaining or not voting": CA does not tell them apart.
  ABS: 'no_vote',
};

export function votePosition(voteCode: string | null): string | undefined {
  return voteCode ? VOTE_POSITIONS[voteCode] : undefined;
}

/** Which house a roll call was taken in, from its location code. */
export function voteHouse(locationCode: string): 'A' | 'S' | undefined {
  if (locationCode === 'AFLOOR' || locationCode.startsWith('CX')) return 'A';
  if (locationCode === 'SFLOOR' || locationCode.startsWith('CS')) return 'S';
  return undefined;
}

/**
 * A roll call's identity within a bill: where, when and which of that
 * moment's votes. bill_votes keys on it so several roll calls on one day
 * (second reading, amendments, reconsideration) each keep their votes.
 */
export function rollCallKey(
  locationCode: string,
  voteDateTime: string,
  voteDateSeq: number,
): string {
  return `${locationCode}:${voteDateTime}:${voteDateSeq}`;
}

/**
 * The chamber a vote row names (D16): `Assembly` / `Senate` for a floor vote,
 * the committee's name with the house spelled out for a committee vote —
 * "Asm Appropriations" → "Assembly Appropriations", as bill_votes holds.
 */
export function voteChamber(
  locationCode: string,
  description: string | undefined,
): string {
  if (locationCode === 'AFLOOR') return 'Assembly';
  if (locationCode === 'SFLOOR') return 'Senate';
  if (!description) return locationCode;
  return description.replace(/^Asm\b/, 'Assembly').replace(/^Sen\b/, 'Senate');
}

/**
 * A legislator name as roll calls and author lists print it, with the stray
 * prefixes the export sometimes carries removed (": Schiavo",
 * "Senator Seyarto": 11 of 105,871 author rows on 2026-11-05).
 */
export function normalizeLegislatorName(name: string): string {
  return name
    .replace(/^[:\s]+/, '')
    .replace(/^(Senator|Assembly Member|Assemblymember)\s+/i, '')
    .trim();
}

/** Key for a legislator: session, house (A/S) and the roll-call name. */
export function legislatorKey(
  sessionYear: string,
  house: string,
  name: string,
): string {
  return `${sessionYear}|${house}|${normalizeLegislatorName(name).toLowerCase()}`;
}

/**
 * Key for a representative seat (D15): `AD78` → `Assembly|78`, `SD02` →
 * `Senate|2`, matching representatives.chamber and .district.
 */
export function seatKey(district: string): string | undefined {
  const match = /^([AS])D0*(\d+)$/.exec(district);
  if (!match) return undefined;
  return `${match[1] === 'A' ? 'Assembly' : 'Senate'}|${match[2]}`;
}

/** An author row's house, from pubinfo's `ASSEMBLY` / `SENATE`. */
export function authorHouse(house: string | null): 'A' | 'S' | undefined {
  if (house === 'ASSEMBLY') return 'A';
  if (house === 'SENATE') return 'S';
  return undefined;
}

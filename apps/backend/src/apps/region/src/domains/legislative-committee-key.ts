/**
 * The `legislative_committees.external_id` scheme, shared by the committee
 * linker (member pages) and the bills derive (the export's hearings,
 * `bills-phase-b.md` D13): `chamber:normalized-name`. Pinned with the bills
 * mapping version, as a change here re-keys committees.
 */

/**
 * A committee's name with its wrapper phrases removed, so variants collapse:
 * "Standing Committee on Budget", "Budget Committee" and "Assembly Budget"
 * all become "budget". The linker's rule, unchanged: existing keys depend on
 * it.
 */
export function normalizeLegislativeCommitteeName(name: string): string {
  const n = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    // Wrapper phrases, longer first.
    .replaceAll(/\bstanding committee on the\b/g, ' ')
    .replaceAll(/\bstanding committee on\b/g, ' ')
    .replaceAll(/\bcommittee on the\b/g, ' ')
    .replaceAll(/\bcommittee on\b/g, ' ')
    .replaceAll(/\bsubcommittee on\b/g, ' ')
    .replaceAll(/\bcommittee\b/g, ' ')
    .replaceAll(/\bsubcommittee\b/g, ' ')
    .replaceAll(/\bassembly\b/g, ' ')
    .replaceAll(/\bsenate\b/g, ' ');
  return n.replaceAll(/\s+/g, ' ').trim();
}

/**
 * The external id for a chamber and raw name, or null when the name
 * normalizes to nothing.
 */
export function committeeExternalId(
  chamber: string,
  rawName: string,
): string | null {
  const normalized = normalizeLegislativeCommitteeName(rawName);
  return normalized ? `${chamber.toLowerCase()}:${normalized}` : null;
}

/**
 * Keys under which a committee named in the export may already exist, and
 * the one to create it under. The export writes "Growth, & Household
 * Impact" where member pages write "and": both spellings are looked up, and
 * a new committee takes the "and" form the linker gives member pages. The
 * linker's own keys are untouched, so no existing committee is re-keyed.
 */
export function committeeKeyCandidates(
  chamber: string,
  rawName: string,
): { create: string; match: string[] } | null {
  const asWritten = committeeExternalId(chamber, rawName);
  const withAnd = committeeExternalId(
    chamber,
    rawName.replaceAll('&', ' and '),
  );
  if (!asWritten || !withAnd) return null;
  return { create: withAnd, match: [...new Set([withAnd, asWritten])] };
}

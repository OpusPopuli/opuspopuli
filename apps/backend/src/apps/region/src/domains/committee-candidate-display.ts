import {
  candidateSurname,
  isCandidateOwnCommittee,
} from './candidate-committee-linker.service';

/**
 * Whether a committee's `candidateName` may be shown as **that committee's
 * candidate** (#1365).
 *
 * `committees.candidate_name` comes from `CVR_CAMPAIGN_DISCLOSURE_CD.CAND_NAML`
 * — the filing COVER PAGE. On a candidate's own committee that is the
 * candidate. On a party committee or PAC filing about independent
 * expenditures, `CAND_NAML` is the candidate the filing is *about*, and the
 * upsert is last-write-wins across every cover page the committee files. So a
 * multi-filing committee ends up carrying an arbitrary one.
 *
 * Measured on the 2026-10-14 resync: of 7,538 committees carrying a
 * `candidate_name`, **1,336 (17.7%)** do not have that surname anywhere in
 * their own name, and those hold $12.328B. The committees page rendered the
 * value as a bare fact — telling readers the California Democratic Party is
 * Jeff Gonzalez's committee, that an advocacy committee is Tim Grayson's, and
 * that `NA` is a person.
 *
 * The test is deliberately `isCandidateOwnCommittee`, the SAME predicate the
 * candidate-committee linker uses to decide attribution (#953). Display and
 * attribution agreeing is the point: a committee whose money we will not
 * attribute to a candidate must not be labelled with that candidate's name
 * either. A second, looser heuristic here would re-open the gap.
 *
 * **Known limitation, measured and accepted.** The linker's marker list
 * catches 'in support of' and 'supporting' but not 'to support', so ~20
 * committees ("Committee to Support George Gascon") keep the label. Widening
 * the marker was tested against the data and rejected: it would also strip
 * "Assemblymember Jacqui Irwin's Committee to Support Veterans…", which
 * genuinely is hers. For that shape the committee's own name states the
 * relationship, so the label adds no false impression — unlike the
 * surname-absent case, which is the $12.3B harm this gate exists for.
 */
export function canShowCommitteeCandidate(
  committeeName: string | null | undefined,
  candidateName: string | null | undefined,
): boolean {
  if (!committeeName || !candidateName) return false;
  if (PLACEHOLDER_CANDIDATE.test(candidateName.trim())) return false;

  const surname = candidateSurname(candidateName);
  if (!surname) return false;

  return isCandidateOwnCommittee(committeeName, surname);
}

/**
 * CAL-ACCESS placeholder values that are not people.
 *
 * Mirrors the filter `RepresentativeFundingPanel` already applies to employers
 * for the same reason — a literal "N/A" rendered as a name reads as a finding
 * when it is a blank field.
 */
const PLACEHOLDER_CANDIDATE = /^(n\/?a|n\.a\.?|none|unknown|not applicable)$/i;

/**
 * The candidate fields a committee may publish, blanked together when the
 * attribution cannot be corroborated.
 *
 * Both or neither: an office with no name is just as unfounded a claim about
 * the committee, and leaving `candidateOffice` behind would let a reader infer
 * the suppressed name from the surrounding row.
 */
export function committeeCandidateFields(committee: {
  name: string | null;
  candidateName: string | null;
  candidateOffice: string | null;
}): { candidateName: string | undefined; candidateOffice: string | undefined } {
  // Required-but-undefined rather than optional: spreading OPTIONAL properties
  // leaves TypeScript unioning them with the `...item` values they are meant
  // to override, so `string | null` survives and the gate silently does
  // nothing at the type level.
  if (!canShowCommitteeCandidate(committee.name, committee.candidateName)) {
    return { candidateName: undefined, candidateOffice: undefined };
  }
  return {
    candidateName: committee.candidateName ?? undefined,
    candidateOffice: committee.candidateOffice ?? undefined,
  };
}

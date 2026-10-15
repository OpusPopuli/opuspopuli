import {
  canShowCommitteeCandidate,
  committeeCandidateFields,
} from './committee-candidate-display';

/**
 * #1365: the committees page named real people as candidates of committees
 * they do not control.
 *
 * `committees.candidate_name` is `CAND_NAML` from the filing COVER PAGE,
 * written last-write-wins. On a party committee or PAC that is the candidate
 * the filing was *about*. Measured on the 2026-10-14 resync, 1,336 of 7,538
 * committees carrying a `candidate_name` (17.7%, holding $12.328B) do not
 * have that surname anywhere in their own name.
 *
 * Every case below is a real row from that resync.
 */
describe('committee candidate display (#1365)', () => {
  const row = (name: string, candidateName: string | null) => ({
    name,
    candidateName,
    candidateOffice: 'ASM',
  });

  describe('suppresses a cover-page name that is not the committee s own', () => {
    it.each([
      ['California Democratic Party', 'Jeff Gonzalez'],
      ['2016 Supervisor Simitian Office Holder Committee', 'Ann Ravel'],
      [
        'A BETTER CALIFORNIA, SPONSORED BY CALIFORNIA ALLIANCE FOR JOBS',
        'TIM GRAYSON',
      ],
      ['40th AD Republican Central Committee (State)', 'Hallman'],
    ])('%s must not be labelled with %s', (committee, candidate) => {
      expect(canShowCommitteeCandidate(committee, candidate)).toBe(false);
    });

    it('blanks the OFFICE together with the name', () => {
      // An office with no name is just as unfounded a claim, and leaving it
      // behind lets a reader infer the suppressed name from the row.
      expect(
        committeeCandidateFields(
          row('California Democratic Party', 'Jeff Gonzalez'),
        ),
      ).toEqual({ candidateName: undefined, candidateOffice: undefined });
    });
  });

  describe('still shows a genuine candidate-controlled committee', () => {
    it.each([
      ['Gonzalez for Assembly 2026', 'Jeff Gonzalez'],
      ['Friends of Buffy Wicks', 'Wicks'],
      ['Re-Elect Al Muratsuchi for Assembly', 'Al Muratsuchi'],
    ])('%s keeps %s', (committee, candidate) => {
      expect(canShowCommitteeCandidate(committee, candidate)).toBe(true);
    });

    it('passes both fields through unchanged', () => {
      expect(
        committeeCandidateFields(row('Gonzalez for Assembly 2026', 'Gonzalez')),
      ).toEqual({ candidateName: 'Gonzalez', candidateOffice: 'ASM' });
    });
  });

  describe('placeholders are not people', () => {
    it.each(['NA', 'na', 'N/A', 'n/a', 'None', 'UNKNOWN', 'not applicable'])(
      '%s is suppressed even on a matching committee',
      (placeholder) => {
        // Real rows: "7-ELEVEN FRANCHISEE'S POLITICAL ACTION COMMITTEE" showed
        // `Candidate: NA`. The codebase already strips these from employers in
        // RepresentativeFundingPanel for exactly this reason.
        expect(canShowCommitteeCandidate('NA Committee', placeholder)).toBe(
          false,
        );
      },
    );
  });

  describe('degenerate input', () => {
    it.each([
      [null, 'Gonzalez'],
      ['Gonzalez for Assembly', null],
      ['', 'Gonzalez'],
      ['Gonzalez for Assembly', ''],
      ['Gonzalez for Assembly', '   '],
    ])('%s / %s is suppressed rather than throwing', (committee, candidate) => {
      expect(canShowCommitteeCandidate(committee, candidate)).toBe(false);
    });
  });

  it('agrees with the linker: an "in support of" committee is never labelled', () => {
    // The predicate IS `isCandidateOwnCommittee`, which the candidate-committee
    // linker uses to decide attribution (#953). Display and attribution agree
    // by construction — money we will not attribute to a candidate does not
    // carry that candidate's name either.
    expect(
      canShowCommitteeCandidate(
        'Neighbors in support of Gonzalez for Assembly 2026',
        'Gonzalez',
      ),
    ).toBe(false);
  });

  it('documents what this does NOT catch: "to support" phrasing', () => {
    // The linker's marker list has 'in support of' and 'supporting' but not
    // 'to support', so ~20 committees such as "CA Justice & Public Safety:
    // Committee to Support George Gascon" still show the label.
    //
    // Deliberately NOT widened. Measured 2026-10-14: adding 'to support'
    // would also strip "Yes on Prop 1, Assemblymember Jacqui Irwin's Committee
    // to Support Veterans…", which genuinely IS hers — trading a false
    // positive for a false negative. And for this shape the committee's own
    // name states the relationship, so a reader seeing "Candidate: Gascon"
    // beside "Committee to Support George Gascon" is not misled. The $12.3B
    // harm this issue exists for is the surname-absent case above.
    expect(
      canShowCommitteeCandidate(
        'CA Justice & Public Safety: Committee to Support George Gascon',
        'Gascon',
      ),
    ).toBe(true);
  });
});

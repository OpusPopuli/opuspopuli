import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  CandidateCommitteeLinkerService,
  isCandidateOwnCommittee,
  chamberFromName,
  candidateSurname,
} from './candidate-committee-linker.service';

interface Rep {
  id: string;
  lastName: string;
  name: string;
  chamber: string;
}
interface Cmte {
  id: string;
  name: string;
  candidateName: string | null;
  candidateOffice: string | null;
}
/** An already-linked committee, as the reconcile pass reads it. */
interface LinkedCmte {
  id: string;
  name: string;
  candidateName: string | null;
}

function build(reps: Rep[], committees: Cmte[], linked: LinkedCmte[] = []) {
  const update = jest.fn((args: unknown) => ({ __op: args }));
  const $transaction = jest.fn().mockResolvedValue([]);
  const repFindMany = jest.fn().mockResolvedValue(reps);
  // linkAll queries committee.findMany twice: the reconcile pass filters
  // `representativeId: { not: null }`, the link pass filters `representativeId: null`.
  const cmteFindMany = jest.fn(
    (args: { where?: { representativeId?: unknown } }) => {
      const rid = args?.where?.representativeId;
      if (rid && typeof rid === 'object' && 'not' in rid) {
        return Promise.resolve(linked); // reconcile pass
      }
      return Promise.resolve(committees); // link pass
    },
  );
  const db = {
    representative: { findMany: repFindMany },
    committee: { findMany: cmteFindMany, update },
    $transaction,
  } as unknown as DbService;
  const svc = new CandidateCommitteeLinkerService(db);
  return { svc, update, repFindMany, cmteFindMany };
}

describe('isCandidateOwnCommittee (#953)', () => {
  it('accepts a committee named after the candidate with no IE/ballot marker', () => {
    expect(isCandidateOwnCommittee('NGUYEN FOR ASSEMBLY 2020', 'Nguyen')).toBe(
      true,
    );
    expect(
      isCandidateOwnCommittee('Friends of Jane Doe for Senate', 'Doe'),
    ).toBe(true);
  });

  it('tolerates CAL-ACCESS punctuation variance on the surname', () => {
    // Committee keeps the apostrophe, candidateName drops it (or vice-versa).
    expect(isCandidateOwnCommittee("O'Brien for Senate 2024", 'OBRIEN')).toBe(
      true,
    );
    expect(
      isCandidateOwnCommittee('Alvarado Gil for Senate', 'Alvarado-Gil'),
    ).toBe(true);
  });

  it('rejects an independent-expenditure "in support of" committee', () => {
    expect(
      isCandidateOwnCommittee(
        'Legislative Action PAC in support of Marie Alvarado-Gil for Senate 2026',
        'Alvarado-Gil',
      ),
    ).toBe(false);
  });

  it('rejects a ballot-measure committee even though it names the candidate', () => {
    expect(
      isCandidateOwnCommittee(
        'Safe Communities, Strong Futures: A Nick Schultz Ballot Measure Committee',
        'Schultz',
      ),
    ).toBe(false);
  });

  it('rejects a sponsored PAC', () => {
    expect(
      isCandidateOwnCommittee(
        'Nurses and Working Families for Better Healthcare, sponsored by SEIU',
        'Umberg',
      ),
    ).toBe(false);
  });

  it('rejects a committee that does not name the candidate at all (union/issue PAC)', () => {
    expect(
      isCandidateOwnCommittee(
        'Los Angeles County Federation of Labor AFL-CIO Council on Political Education',
        'Gonzalez',
      ),
    ).toBe(false);
  });

  it('does not gate on surnames too short to match safely', () => {
    // "Vo" (2 chars) would substring-match "vote"/"advocacy"; fall back to
    // office/name matching for these rather than false-reject.
    expect(isCandidateOwnCommittee('Committee to Elect Vo', 'Vo')).toBe(true);
  });
});

describe('chamberFromName (#953)', () => {
  it('infers the chamber from a controlled committee name', () => {
    expect(chamberFromName('Friends of Jane Doe for Assembly 2024')).toBe(
      'Assembly',
    );
    expect(chamberFromName('Gonzalez for Senate 2024')).toBe('Senate');
    expect(chamberFromName('Committee to Elect Doe for State Assembly')).toBe(
      'Assembly',
    );
  });

  it('returns null when no chamber word is present', () => {
    expect(chamberFromName('Some Random Committee 2024')).toBeNull();
  });
});

describe('candidateSurname (#953)', () => {
  it('returns a bare surname unchanged', () => {
    expect(candidateSurname('Doe')).toBe('Doe');
  });
  it('takes the part before a comma for "Last, First"', () => {
    expect(candidateSurname('Doe, Jane')).toBe('Doe');
  });
  it('takes the final token for "First [Middle] Last" (the case that capped yield)', () => {
    expect(candidateSurname('Tina McKinnor')).toBe('McKinnor');
    expect(candidateSurname('Jane Marie Doe')).toBe('Doe');
  });
  it('drops a trailing generational suffix', () => {
    expect(candidateSurname('John Smith Jr')).toBe('Smith');
    expect(candidateSurname('John Smith Jr.')).toBe('Smith');
    expect(candidateSurname('Bob Jones III')).toBe('Jones');
  });
});

describe('CandidateCommitteeLinkerService (#941)', () => {
  it('links a candidate’s own controlled committee by last name + office→chamber', async () => {
    const { svc, update } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-1',
          name: 'Doe for Assembly 2024',
          candidateName: 'Doe',
          candidateOffice: 'ASM',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-1' },
    });
  });

  it('skips a committee that matches a rep but is not the candidate’s own (#953)', async () => {
    const { svc, update } = build(
      [
        {
          id: 'rep-1',
          lastName: 'Alvarado-Gil',
          name: 'Marie Alvarado-Gil',
          chamber: 'Senate',
        },
      ],
      [
        {
          id: 'c-ie',
          name: 'Legislative Action PAC in support of Marie Alvarado-Gil for Senate 2026',
          candidateName: 'Alvarado-Gil',
          candidateOffice: 'SEN',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.skippedNonControlled).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('skips an ambiguous last name shared by two reps in the same chamber', async () => {
    const { svc, update } = build(
      [
        {
          id: 'rep-1',
          lastName: 'Garcia',
          name: 'A Garcia',
          chamber: 'Assembly',
        },
        {
          id: 'rep-2',
          lastName: 'Garcia',
          name: 'B Garcia',
          chamber: 'Assembly',
        },
      ],
      [
        {
          id: 'c-1',
          name: 'Garcia for Assembly',
          candidateName: 'Garcia',
          candidateOffice: 'ASM',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.skippedAmbiguous).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not cross chambers — same last name in different chambers stays unambiguous', async () => {
    const { svc, update } = build(
      [
        { id: 'rep-asm', lastName: 'Lee', name: 'A Lee', chamber: 'Assembly' },
        { id: 'rep-sen', lastName: 'Lee', name: 'B Lee', chamber: 'Senate' },
      ],
      [
        {
          id: 'c-1',
          name: 'Lee for Senate 2024',
          candidateName: 'Lee',
          candidateOffice: 'SEN',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-sen' },
    });
  });

  it('matches case/punctuation-insensitively on the surname', async () => {
    const { svc } = build(
      [
        {
          id: 'rep-1',
          lastName: "O'Brien",
          name: "Pat O'Brien",
          chamber: 'Senate',
        },
      ],
      [
        {
          id: 'c-1',
          name: "O'Brien for Senate 2024",
          candidateName: 'OBRIEN',
          candidateOffice: 'senate',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
  });

  it('links a committee whose candidateName is a full "First Last" (#953)', async () => {
    // CAL-ACCESS stores many CAND_NAML as "First Last"; before the fix this
    // normalized to the whole name and matched nothing, capping yield at ~5/120.
    const { svc, update } = build(
      [
        {
          id: 'rep-m',
          lastName: 'McKinnor',
          name: 'Tina McKinnor',
          chamber: 'Assembly',
        },
      ],
      [
        {
          id: 'c-1',
          name: 'Tina McKinnor for Assembly 2024',
          candidateName: 'Tina McKinnor',
          candidateOffice: 'ASM',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-m' },
    });
  });

  it('counts unmatched for a non-legislative office or an unknown name', async () => {
    const { svc, update } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-unknown',
          name: 'Nobody for Assembly',
          candidateName: 'Nobody',
          candidateOffice: 'ASM',
        },
        {
          id: 'c-gov',
          name: 'Doe for Governor',
          candidateName: 'Doe',
          candidateOffice: 'GOV',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.unmatched).toBe(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('derives the last name from full name when lastName is empty', async () => {
    const { svc, update } = build(
      [{ id: 'rep-1', lastName: '', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-1',
          name: 'Doe for Assembly',
          candidateName: 'Doe',
          candidateOffice: 'ASM',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-1' },
    });
  });

  it('scopes queries: only unlinked cal_access committees, and excludes federal reps', async () => {
    const { svc, repFindMany, cmteFindMany } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-1',
          name: 'Doe for Assembly',
          candidateName: 'Doe',
          candidateOffice: 'ASM',
        },
      ],
    );
    await svc.linkAll();
    // The link pass (representativeId: null) is state-scoped to unlinked
    // cal_access committees. (calls[0] is now the reconcile pass.)
    const linkCall = cmteFindMany.mock.calls.find(
      (c: [{ where?: { representativeId?: unknown } }]) =>
        c[0]?.where?.representativeId === null,
    );
    // Eligibility no longer gates on type='candidate' (#953): CAL-ACCESS
    // mis-types many candidate committees as 'other', so all unlinked cal_access
    // committees are considered and precision is enforced by the name-gate.
    expect(linkCall?.[0].where).toMatchObject({
      representativeId: null,
      sourceSystem: 'cal_access',
    });
    expect(linkCall?.[0].where).not.toHaveProperty('type');
    // federal reps excluded so US-Senate can't collide with CA State Senate
    expect(repFindMany.mock.calls[0][0].where).toMatchObject({
      regionId: { not: 'federal' },
    });
  });

  it('recovers a controlled committee that has no CAND_NAML, from its name (#953 yield)', async () => {
    const { svc, update } = build(
      [
        {
          id: 'rep-g',
          lastName: 'Gonzalez',
          name: 'Lena Gonzalez',
          chamber: 'Senate',
        },
      ],
      [
        {
          id: 'c-friends',
          name: 'Friends of Lena Gonzalez for Senate 2024',
          candidateName: null,
          candidateOffice: null,
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-friends' },
      data: { representativeId: 'rep-g' },
    });
  });

  it('recovers the chamber from the name when CAND_NAML is present but OFFICE_CD is blank (#953 yield)', async () => {
    const { svc } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-1',
          name: 'Doe for Assembly 2024',
          candidateName: 'Doe',
          candidateOffice: null,
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
  });

  it('skips a CAND_NAML-less committee whose name matches two reps in the chamber (ambiguous)', async () => {
    const { svc, update } = build(
      [
        { id: 'rep-a', lastName: 'Lee', name: 'A Lee', chamber: 'Assembly' },
        { id: 'rep-b', lastName: 'Lee', name: 'B Lee', chamber: 'Assembly' },
      ],
      [
        {
          id: 'c-1',
          name: 'Lee for Assembly 2024',
          candidateName: null,
          candidateOffice: null,
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.skippedAmbiguous).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves a CAND_NAML-less committee unmatched when its name has no chamber', async () => {
    const { svc } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        {
          id: 'c-1',
          name: 'Doe Ventures LLC',
          candidateName: null,
          candidateOffice: null,
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.unmatched).toBe(1);
  });

  it('still excludes a name-recovered committee that is actually an IE (#953)', async () => {
    const { svc } = build(
      [
        {
          id: 'rep-g',
          lastName: 'Gonzalez',
          name: 'Lena Gonzalez',
          chamber: 'Senate',
        },
      ],
      [
        {
          id: 'c-ie',
          name: 'Workers United in support of Gonzalez for Senate',
          candidateName: null,
          candidateOffice: null,
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.skippedNonControlled).toBe(1);
  });

  it('self-heals: unlinks an already-linked committee that fails the controlled gate (#953)', async () => {
    const { svc, update } = build(
      [
        {
          id: 'rep-1',
          lastName: 'Gonzalez',
          name: 'Lena Gonzalez',
          chamber: 'Senate',
        },
      ],
      [], // nothing new to link this run
      [
        {
          id: 'c-badpac',
          name: 'Los Angeles County Federation of Labor AFL-CIO Council on Political Education',
          candidateName: 'Gonzalez',
        },
        {
          id: 'c-good',
          name: 'Gonzalez for Senate 2024',
          candidateName: 'Gonzalez',
        },
      ],
    );
    const res = await svc.linkAll();
    expect(res.reconciledUnlinked).toBe(1);
    // The union PAC is unlinked; the genuine controlled committee is left alone.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-badpac' },
      data: { representativeId: null },
    });
    expect(update).not.toHaveBeenCalledWith({
      where: { id: 'c-good' },
      data: { representativeId: null },
    });
  });

  it('is a no-op with no db wired', async () => {
    const svc = new CandidateCommitteeLinkerService();
    const res = await svc.linkAll();
    expect(res).toEqual({
      linked: 0,
      skippedAmbiguous: 0,
      skippedNonControlled: 0,
      reconciledUnlinked: 0,
      unmatched: 0,
      candidateCommittees: 0,
    });
  });
});

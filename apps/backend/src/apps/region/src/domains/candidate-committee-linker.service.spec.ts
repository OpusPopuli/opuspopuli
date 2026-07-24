import { DbService } from '@opuspopuli/relationaldb-provider';
import { CandidateCommitteeLinkerService } from './candidate-committee-linker.service';

interface Rep {
  id: string;
  lastName: string;
  name: string;
  chamber: string;
}
interface Cmte {
  id: string;
  candidateName: string | null;
  candidateOffice: string | null;
}

function build(reps: Rep[], committees: Cmte[]) {
  const update = jest.fn((args: unknown) => ({ __op: args }));
  const $transaction = jest.fn().mockResolvedValue([]);
  const db = {
    representative: { findMany: jest.fn().mockResolvedValue(reps) },
    committee: { findMany: jest.fn().mockResolvedValue(committees), update },
    $transaction,
  } as unknown as DbService;
  const svc = new CandidateCommitteeLinkerService(db);
  return { svc, update };
}

describe('CandidateCommitteeLinkerService (#941)', () => {
  it('links a candidate committee to a rep by last name + office→chamber', async () => {
    const { svc, update } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [{ id: 'c-1', candidateName: 'Doe', candidateOffice: 'ASM' }],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-1' },
    });
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
      [{ id: 'c-1', candidateName: 'Garcia', candidateOffice: 'ASM' }],
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
      [{ id: 'c-1', candidateName: 'Lee', candidateOffice: 'SEN' }],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { representativeId: 'rep-sen' },
    });
  });

  it('matches case/punctuation-insensitively', async () => {
    const { svc } = build(
      [
        {
          id: 'rep-1',
          lastName: "O'Brien",
          name: "Pat O'Brien",
          chamber: 'Senate',
        },
      ],
      [{ id: 'c-1', candidateName: 'OBRIEN', candidateOffice: 'senate' }],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(1);
  });

  it('counts unmatched for a non-legislative office or an unknown name', async () => {
    const { svc, update } = build(
      [{ id: 'rep-1', lastName: 'Doe', name: 'Jane Doe', chamber: 'Assembly' }],
      [
        { id: 'c-unknown', candidateName: 'Nobody', candidateOffice: 'ASM' },
        { id: 'c-gov', candidateName: 'Doe', candidateOffice: 'GOV' },
      ],
    );
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.unmatched).toBe(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('is a no-op with no db wired', async () => {
    const svc = new CandidateCommitteeLinkerService();
    const res = await svc.linkAll();
    expect(res).toEqual({
      linked: 0,
      skippedAmbiguous: 0,
      unmatched: 0,
      candidateCommittees: 0,
    });
  });
});

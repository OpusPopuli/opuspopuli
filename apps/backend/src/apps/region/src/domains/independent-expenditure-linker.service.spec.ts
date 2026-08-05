import { DbService } from '@opuspopuli/relationaldb-provider';
import { IndependentExpenditureLinkerService } from './independent-expenditure-linker.service';

interface PendingIe {
  id: string;
  filingId: string | null;
}
interface Cover {
  filingId: string;
  filerId: string;
  candidateName: string | null;
  propositionTitle: string | null;
  supportOrOppose: string | null;
}
interface Cmte {
  externalId: string;
  id: string;
  name: string;
}

function build(opts: {
  pending?: PendingIe[];
  covers?: Cover[];
  committees?: Cmte[];
}) {
  const update = jest.fn((args: unknown) => ({ __op: args }));
  const $transaction = jest.fn().mockResolvedValue([]);
  const ieFindMany = jest.fn().mockResolvedValue(opts.pending ?? []);
  const cvrFindMany = jest.fn().mockResolvedValue(opts.covers ?? []);
  const cmteFindMany = jest.fn().mockResolvedValue(opts.committees ?? []);
  const db = {
    independentExpenditure: { findMany: ieFindMany, update },
    cvrFiling: { findMany: cvrFindMany },
    committee: { findMany: cmteFindMany },
    $transaction,
  } as unknown as DbService;
  const svc = new IndependentExpenditureLinkerService(db);
  return { svc, update, ieFindMany, cvrFindMany, cmteFindMany };
}

describe('IndependentExpenditureLinkerService (#955)', () => {
  it('links a committee-less IE via filing -> cover page -> committee', async () => {
    const { svc, update } = build({
      pending: [{ id: 'ie1', filingId: 'F1' }],
      covers: [
        {
          filingId: 'F1',
          filerId: 'C9',
          candidateName: 'Jane Doe',
          propositionTitle: null,
          supportOrOppose: 'oppose',
        },
      ],
      committees: [{ externalId: 'C9', id: 'cmte-uuid', name: 'Super PAC' }],
    });

    const res = await svc.linkAll();

    expect(res).toMatchObject({
      linked: 1,
      skippedNoCoverPage: 0,
      skippedNoCommittee: 0,
      considered: 1,
    });
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0][0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: 'ie1' });
    expect(args.data).toMatchObject({
      committeeId: 'cmte-uuid',
      committeeName: 'Super PAC',
      candidateName: 'Jane Doe',
      supportOrOppose: 'oppose',
    });
  });

  it('only considers unresolved IEs — queries committeeId: null (idempotent)', async () => {
    const { svc, ieFindMany } = build({ pending: [] });
    const res = await svc.linkAll();
    expect(res.linked).toBe(0);
    expect(res.considered).toBe(0);
    expect(ieFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { committeeId: null, filingId: { not: null } },
      }),
    );
  });

  it('skips an IE whose filing has no Form 496 cover page', async () => {
    const { svc, update } = build({
      pending: [{ id: 'ie1', filingId: 'F-MISSING' }],
      covers: [
        {
          filingId: 'F1',
          filerId: 'C9',
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: null,
        },
      ],
      committees: [{ externalId: 'C9', id: 'cmte-uuid', name: 'Super PAC' }],
    });

    const res = await svc.linkAll();

    expect(res).toMatchObject({ linked: 0, skippedNoCoverPage: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  it('skips an IE whose cover-page filer matches no committee', async () => {
    const { svc, update } = build({
      pending: [{ id: 'ie1', filingId: 'F1' }],
      covers: [
        {
          filingId: 'F1',
          filerId: 'C-UNKNOWN',
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: null,
        },
      ],
      committees: [],
    });

    const res = await svc.linkAll();

    expect(res).toMatchObject({ linked: 0, skippedNoCommittee: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  it('counts every pending IE as noCoverPage when no cover pages exist yet', async () => {
    const { svc } = build({
      pending: [
        { id: 'ie1', filingId: 'F1' },
        { id: 'ie2', filingId: 'F2' },
      ],
      covers: [],
    });

    const res = await svc.linkAll();

    expect(res).toMatchObject({
      linked: 0,
      considered: 2,
      skippedNoCoverPage: 2,
    });
  });

  it('is a no-op when no DbService is injected', async () => {
    const svc = new IndependentExpenditureLinkerService();
    const res = await svc.linkAll();
    expect(res).toEqual({
      linked: 0,
      skippedNoCoverPage: 0,
      skippedNoCommittee: 0,
      considered: 0,
    });
  });
});

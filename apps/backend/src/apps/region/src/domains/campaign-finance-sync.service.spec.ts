import { DbService } from '@opuspopuli/relationaldb-provider';
import type { CampaignFinanceResult } from '@opuspopuli/common';
import { CampaignFinanceSyncService } from './campaign-finance-sync.service';

type RosterCommittee = CampaignFinanceResult['committees'][number];

function build() {
  const upsert = jest.fn((args: unknown) => ({ __op: args }));
  const $transaction = jest.fn().mockResolvedValue([]);
  const db = { committee: { upsert }, $transaction } as unknown as DbService;
  const svc = new CampaignFinanceSyncService(db);
  return { svc, upsert, $transaction };
}

function committee(
  over: Partial<Omit<RosterCommittee, 'type'>> & { type?: string } = {},
): RosterCommittee {
  return {
    externalId: 'C001',
    name: 'Friends of Jane Doe',
    type: 'candidate',
    candidateName: 'Doe',
    candidateOffice: 'ASM',
    party: 'DEM',
    status: 'active',
    sourceSystem: 'cal_access',
    ...over,
  } as RosterCommittee;
}

function result(committees: RosterCommittee[]): CampaignFinanceResult {
  return {
    committees,
    contributions: [],
    expenditures: [],
    independentExpenditures: [],
    committeeMeasureFilings: [],
  };
}

const enrich = (svc: CampaignFinanceSyncService, data: CampaignFinanceResult) =>
  (
    svc as unknown as {
      enrichCommittees: (d: CampaignFinanceResult) => Promise<void>;
    }
  ).enrichCommittees(data);

describe('CampaignFinanceSyncService.enrichCommittees (#939)', () => {
  it('upserts each roster committee by externalId with its real identity', async () => {
    const { svc, upsert, $transaction } = build();
    await enrich(svc, result([committee()]));

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    // keyed by externalId → enriches the existing row in place (no id churn)
    expect(args.where).toEqual({ externalId: 'C001' });
    expect(args.create).toMatchObject({
      externalId: 'C001',
      name: 'Friends of Jane Doe',
      type: 'candidate',
      candidateName: 'Doe',
      candidateOffice: 'ASM',
    });
    expect(args.update).toMatchObject({
      name: 'Friends of Jane Doe',
      type: 'candidate',
      candidateName: 'Doe',
    });
    expect($transaction).toHaveBeenCalled();
  });

  it('dedups repeated cover-page rows by externalId (last wins)', async () => {
    const { svc, upsert } = build();
    await enrich(
      svc,
      result([
        committee({ name: 'Stale Name' }),
        committee({ name: 'Current Name' }),
      ]),
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    const create = (
      upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    ).create;
    expect(create.name).toBe('Current Name');
  });

  it('never blanks an existing candidate/party field when a filing lacks it', async () => {
    const { svc, upsert } = build();
    await enrich(
      svc,
      result([
        committee({
          candidateName: undefined,
          candidateOffice: undefined,
          party: undefined,
        }),
      ]),
    );

    const update = (
      upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    ).update;
    expect(update).not.toHaveProperty('candidateName');
    expect(update).not.toHaveProperty('candidateOffice');
    expect(update).not.toHaveProperty('party');
    // name + type always refresh (roster is authoritative for those)
    expect(update.name).toBeDefined();
    expect(update.type).toBeDefined();
  });

  it('does not overwrite an enriched type with a later blank (other) filing', async () => {
    const { svc, upsert } = build();
    await enrich(svc, result([committee({ type: 'other' })]));

    const update = (
      upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    ).update;
    // 'other' must not downgrade a committee already typed candidate/pac/etc.
    expect(update).not.toHaveProperty('type');
    // a recognized type still refreshes
    upsert.mockClear();
    await enrich(svc, result([committee({ type: 'candidate' })]));
    const update2 = (
      upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    ).update;
    expect(update2.type).toBe('candidate');
  });

  it('skips roster records with no externalId', async () => {
    const { svc, upsert, $transaction } = build();
    await enrich(
      svc,
      result([committee({ externalId: '' as unknown as string })]),
    );
    expect(upsert).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no roster committees', async () => {
    const { svc, upsert, $transaction } = build();
    await enrich(svc, result([]));
    expect(upsert).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

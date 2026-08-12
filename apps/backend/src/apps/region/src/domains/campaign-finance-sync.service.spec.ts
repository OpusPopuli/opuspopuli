import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  emptyCampaignFinanceResult,
  type CampaignFinanceResult,
} from '@opuspopuli/common';
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

// Spread the shared empty shape rather than listing buckets: a new table then
// needs no edit here, and cannot be silently forgotten.
function result(committees: RosterCommittee[]): CampaignFinanceResult {
  return { ...emptyCampaignFinanceResult(), committees };
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

describe('CampaignFinanceSyncService — post-sync linker ordering (#980)', () => {
  function buildWithLinkers() {
    const db = {
      committee: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as DbService;

    const linker = (name: string) => ({
      linkAll: jest.fn().mockResolvedValue({ name }),
    });
    const amendmentSupersession = {
      supersedeAll: jest.fn().mockResolvedValue({ name: 'supersession' }),
    };
    const filingReconciliation = {
      reconcileAll: jest.fn().mockResolvedValue({ name: 'reconciliation' }),
    };
    const propositionFinanceLinker = linker('proposition');
    const candidateCommitteeLinker = linker('candidate');
    const independentExpenditureLinker = linker('ie');
    const coverPageLinker = linker('coverPage');

    const svc = new CampaignFinanceSyncService(
      db,
      propositionFinanceLinker as never,
      candidateCommitteeLinker as never,
      independentExpenditureLinker as never,
      coverPageLinker as never,
      amendmentSupersession as never,
      filingReconciliation as never,
    );

    const provider = {
      fetchCampaignFinance: jest.fn().mockResolvedValue(result([])),
    };

    return {
      svc,
      provider,
      coverPageLinker,
      propositionFinanceLinker,
      independentExpenditureLinker,
      amendmentSupersession,
      filingReconciliation,
    };
  }

  it('runs the cover-page linker BEFORE the proposition linker', async () => {
    // Load-bearing ordering, not a preference. The proposition linker derives
    // measure positions from `filing_id -> committee_id`, which only exists
    // once the cover-page linker has stamped it. Reverse these and proposition
    // funding silently reads $0 — no exception, nothing fails.
    const { svc, provider, coverPageLinker, propositionFinanceLinker } =
      buildWithLinkers();

    await svc.sync(provider as never);

    expect(coverPageLinker.linkAll).toHaveBeenCalled();
    expect(propositionFinanceLinker.linkAll).toHaveBeenCalled();
    expect(coverPageLinker.linkAll.mock.invocationCallOrder[0]).toBeLessThan(
      propositionFinanceLinker.linkAll.mock.invocationCallOrder[0],
    );
  });

  it('supersedes amendments BEFORE attributing anything (#992)', async () => {
    // Load-bearing. A superseded amendment's rows are stale duplicates; if the
    // cover-page linker runs first it attributes rows that are about to be
    // deleted, and reports a linked count describing them.
    const { svc, provider, amendmentSupersession, coverPageLinker } =
      buildWithLinkers();

    await svc.sync(provider as never);

    expect(amendmentSupersession.supersedeAll).toHaveBeenCalled();
    expect(
      amendmentSupersession.supersedeAll.mock.invocationCallOrder[0],
    ).toBeLessThan(coverPageLinker.linkAll.mock.invocationCallOrder[0]);
  });

  it('reconciles AFTER every linker has run (#992)', async () => {
    // Also load-bearing, pointing the other way. Reconciliation judges the
    // final state: it needs supersession to have dropped stale amendments and
    // the cover-page linker to have stamped committeeId. Run it earlier and it
    // reconciles rows about to vanish, and attributes its verdict to nobody.
    const { svc, provider, filingReconciliation, coverPageLinker } =
      buildWithLinkers();

    await svc.sync(provider as never);

    expect(filingReconciliation.reconcileAll).toHaveBeenCalled();
    expect(
      filingReconciliation.reconcileAll.mock.invocationCallOrder[0],
    ).toBeGreaterThan(coverPageLinker.linkAll.mock.invocationCallOrder[0]);
  });

  it('still completes the sync when reconciliation throws', async () => {
    // Reconciliation only reports; it must never cost the sync its data.
    const { svc, provider, filingReconciliation } = buildWithLinkers();
    filingReconciliation.reconcileAll.mockRejectedValue(new Error('boom'));

    await expect(svc.sync(provider as never)).resolves.toBeDefined();
  });

  it('still attributes when supersession throws', async () => {
    const { svc, provider, amendmentSupersession, coverPageLinker } =
      buildWithLinkers();
    amendmentSupersession.supersedeAll.mockRejectedValue(new Error('boom'));

    await expect(svc.sync(provider as never)).resolves.toBeDefined();

    expect(coverPageLinker.linkAll).toHaveBeenCalled();
  });

  it('still runs the proposition linker when the cover-page linker throws', async () => {
    const { svc, provider, coverPageLinker, propositionFinanceLinker } =
      buildWithLinkers();
    coverPageLinker.linkAll.mockRejectedValue(new Error('boom'));

    await expect(svc.sync(provider as never)).resolves.toBeDefined();

    expect(propositionFinanceLinker.linkAll).toHaveBeenCalled();
  });
});

describe('CampaignFinanceSyncService — newest amendment wins (#992)', () => {
  type Row = Record<string, unknown>;

  function buildUpsert(
    stored: Array<{ externalId: string; amendId?: number }>,
  ) {
    const upsert = jest.fn((args: unknown) => ({ __op: args }));
    const findMany = jest.fn().mockResolvedValue(stored);
    const $transaction = jest.fn().mockResolvedValue([]);
    const db = { $transaction } as unknown as DbService;
    const svc = new CampaignFinanceSyncService(db);

    const run = (records: Row[], amendable = true) =>
      (
        svc as unknown as {
          upsertRecordsByFields: (c: unknown) => Promise<{
            processed: number;
            created: number;
            updated: number;
          }>;
        }
      ).upsertRecordsByFields({
        records,
        model: { findMany, upsert },
        fields: ['filingId', 'amendId', 'amount'],
        amendable,
      });

    // The rows that actually reached the database, in write order.
    const written = () =>
      upsert.mock.calls.map(
        (c) => (c[0] as { update: Row }).update as { amendId?: number },
      );

    return { run, written, upsert, findMany };
  }

  const row = (over: Partial<Row> = {}): Row => ({
    externalId: 'F1:1:T1',
    filingId: 'F1',
    amendId: 0,
    amount: 100,
    ...over,
  });

  it('keeps the newest version when a batch restates the same row out of order', async () => {
    // The whole point: 454 RCPT_CD rows on the 2026-08-09 export list a
    // DECREASING AMEND_ID, so plain last-write-wins stores the superseded
    // version. Supersession then deletes it for sitting below the filing's
    // max(amend_id), and real contributions vanish from the total.
    const { run, written } = buildUpsert([]);

    await run([
      row({ amendId: 1, amount: 250 }),
      row({ amendId: 0, amount: 100 }), // older, but arrives last
    ]);

    expect(written()).toHaveLength(1);
    expect(written()[0].amendId).toBe(1);
    expect(written()[0]).toMatchObject({ amount: 250 });
  });

  it('does not let an older amendment overwrite a newer one already stored', async () => {
    // Cross-batch: the newer version landed in an earlier batch, so the guard
    // has to consult the database, not just the batch.
    const { run, upsert } = buildUpsert([
      { externalId: 'F1:1:T1', amendId: 2 },
    ]);

    const res = await run([row({ amendId: 1, amount: 100 })]);

    expect(upsert).not.toHaveBeenCalled();
    expect(res).toEqual({ processed: 0, created: 0, updated: 0 });
  });

  it('re-writes the same amendment, so a re-sync stays idempotent', async () => {
    const { run, upsert } = buildUpsert([
      { externalId: 'F1:1:T1', amendId: 2 },
    ]);

    await run([row({ amendId: 2, amount: 100 })]);

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('writes a newer amendment over a stored older one', async () => {
    const { run, written } = buildUpsert([
      { externalId: 'F1:1:T1', amendId: 1 },
    ]);

    await run([row({ amendId: 3, amount: 400 })]);

    expect(written()[0].amendId).toBe(3);
  });

  it('leaves rows carrying no amendId on arrival order', async () => {
    // Sources with no AMEND_ID (FEC, and CAL-ACCESS rows predating the
    // mapping) have nothing to order by — last write still wins there.
    const { run, written } = buildUpsert([]);

    await run([
      row({ amendId: undefined, amount: 100 }),
      row({ amendId: undefined, amount: 900 }),
    ]);

    expect(written()).toHaveLength(1);
    expect(written()[0]).toMatchObject({ amount: 900 });
  });

  it('does not consult amendId on tables that are not amendable', async () => {
    // Committees, cover pages and CVR2 rows are keyed one-per-filing and carry
    // no amendment axis; the guard must not silently drop their rows.
    const { run, upsert, findMany } = buildUpsert([]);

    await run([row({ amendId: 1 }), row({ amendId: 0 })], false);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      select: { externalId: true },
    });
  });

  it('treats a stored row with a null amendId as overwritable', async () => {
    // Rows ingested before the amend_id column existed. They must not be
    // pinned in place by the guard, or a re-sync could never correct them.
    const { run, upsert } = buildUpsert([
      { externalId: 'F1:1:T1', amendId: undefined },
    ]);

    await run([row({ amendId: 0 })]);

    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('CampaignFinanceSyncService — final flush covers every table (#992)', () => {
  it('flushes a fetch carrying only filing summaries', async () => {
    // The flush is gated on "did anything arrive?", and that gate has to name
    // every table it writes. Miss one and its rows are dropped whenever no
    // other table happens to carry data in the same fetch — silently, and only
    // for that shape of config.
    const upsert = jest.fn((args: unknown) => ({ __op: args }));
    const findMany = jest.fn().mockResolvedValue([]);
    const db = {
      committee: { upsert, findMany },
      filingSummary: { upsert, findMany },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as DbService;
    const svc = new CampaignFinanceSyncService(db);

    const provider = {
      fetchCampaignFinance: jest.fn().mockResolvedValue({
        ...result([]),
        filingSummaries: [
          {
            externalId: '2505994:1:F460:1',
            filingId: '2505994',
            amendId: 1,
            formType: 'F460',
            lineItem: '1',
            amountA: 170988.25,
            sourceSystem: 'cal_access',
          },
        ],
      }),
    };

    const res = await svc.sync(provider as never);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(res.processed).toBe(1);
  });
});

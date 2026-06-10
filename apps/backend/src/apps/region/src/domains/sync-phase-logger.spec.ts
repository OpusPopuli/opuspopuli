import { Logger } from '@nestjs/common';

import {
  BILL_SYNC_PHASES,
  REP_SYNC_PHASES,
  MEETING_SYNC_PHASES,
  MINUTES_SYNC_PHASES,
  PROPOSITION_SYNC_PHASES,
  CIVICS_SYNC_PHASES,
  CAMPAIGN_FINANCE_SYNC_PHASES,
  SyncPhaseTracker,
  billSyncTracker,
  repSyncTracker,
  meetingSyncTracker,
  minutesSyncTracker,
  propositionSyncTracker,
  civicsSyncTracker,
  campaignFinanceSyncTracker,
  __testing,
} from './sync-phase-logger';

describe('SyncPhaseTracker', () => {
  let logger: Logger;
  let log: jest.Mock;

  beforeEach(() => {
    log = jest.fn();
    logger = { log } as unknown as Logger;
  });

  describe('phase-start line', () => {
    it('emits the canonical format', () => {
      new SyncPhaseTracker(
        logger,
        'TestSync',
        ['a', 'b', 'c'] as const,
        'b',
        100,
      );
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 2/3 (b) starting: 100 items',
      );
    });

    it('appends summary args inline', () => {
      new SyncPhaseTracker(logger, 'TestSync', ['a'] as const, 'a', 0, {
        sources: 2,
        regionId: 'california',
      });
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 (a) starting: 0 items sources=2 regionId=california',
      );
    });

    it('throws when phase is not in the phases list', () => {
      expect(
        () =>
          new SyncPhaseTracker(
            logger,
            'TestSync',
            ['a', 'b'] as const,
            'c' as 'a' | 'b',
            0,
          ),
      ).toThrow(/Phase "c" not in phases list/);
    });
  });

  describe('per-item logging', () => {
    it('emits line with name + externalId when both present', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        5,
      );
      log.mockClear();
      t.item({
        name: 'AB 96',
        externalId: '202520260AB96',
        outcomeLabel: 'created (LLM)',
        outcome: 'created',
      });
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 [1/5] AB 96 (202520260AB96): created (LLM)',
      );
    });

    it('falls back to `--` when neither name nor externalId is present', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        5,
      );
      log.mockClear();
      t.item({
        name: null,
        externalId: null,
        outcomeLabel: 'skipped: malformed URL',
        outcome: 'skipped',
      });
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 [1/5] --: skipped: malformed URL',
      );
    });

    it('shows externalId in parens when name is missing — the votes-only gap case', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        5,
      );
      log.mockClear();
      t.item({
        name: null,
        externalId: '202520260AB2649',
        outcomeLabel: 'skipped: no shell',
        outcome: 'skipped',
      });
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 [1/5] -- (202520260AB2649): skipped: no shell',
      );
    });

    it('counter increments monotonically across calls', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        5,
      );
      log.mockClear();
      for (let i = 0; i < 3; i++) {
        t.item({
          name: `item-${i + 1}`,
          externalId: `id-${i + 1}`,
          outcomeLabel: 'created',
          outcome: 'created',
        });
      }
      expect(log).toHaveBeenNthCalledWith(
        1,
        '[TestSync] Phase 1/1 [1/5] item-1 (id-1): created',
      );
      expect(log).toHaveBeenNthCalledWith(
        2,
        '[TestSync] Phase 1/1 [2/5] item-2 (id-2): created',
      );
      expect(log).toHaveBeenNthCalledWith(
        3,
        '[TestSync] Phase 1/1 [3/5] item-3 (id-3): created',
      );
    });
  });

  describe('itemUnknown', () => {
    it('emits line and bumps skipped only', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        100,
      );
      log.mockClear();
      t.itemUnknown('no shell for 202520260AB2640', '202520260AB2640');
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 [1/100] -- (202520260AB2640): skipped: no shell for 202520260AB2640',
      );
      const result = t.complete();
      expect(result).toMatchObject({
        created: 0,
        updated: 0,
        skipped: 1,
        errors: 0,
      });
    });

    it('handles missing externalId hint', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        100,
      );
      log.mockClear();
      t.itemUnknown('source returned nothing');
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 [1/100] --: skipped: source returned nothing',
      );
    });
  });

  describe('note (mid-phase aggregate)', () => {
    it('emits without bumping per-item counter', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['discover'] as const,
        'discover',
        2,
      );
      log.mockClear();
      t.note('source 1/2: 1234 bills');
      expect(log).toHaveBeenCalledWith(
        '[TestSync] Phase 1/1 (discover): source 1/2: 1234 bills',
      );
      const result = t.complete();
      expect(
        result.created + result.updated + result.skipped + result.errors,
      ).toBe(0);
    });
  });

  describe('complete()', () => {
    it('aggregates created/updated/skipped/errors', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        10,
      );
      t.item({
        name: 'A',
        externalId: 'a',
        outcomeLabel: 'c',
        outcome: 'created',
      });
      t.item({
        name: 'B',
        externalId: 'b',
        outcomeLabel: 'u',
        outcome: 'updated',
      });
      t.item({
        name: 'C',
        externalId: 'c',
        outcomeLabel: 'u',
        outcome: 'updated',
      });
      t.item({
        name: 'D',
        externalId: 'd',
        outcomeLabel: 's',
        outcome: 'skipped',
      });
      t.item({
        name: 'E',
        externalId: 'e',
        outcomeLabel: 'e',
        outcome: 'error',
      });
      log.mockClear();
      const result = t.complete();
      expect(result).toMatchObject({
        created: 1,
        updated: 2,
        skipped: 1,
        errors: 1,
      });
      expect(log.mock.calls[0][0]).toMatch(
        /\[TestSync\] Phase 1\/1 \(p\) complete: 1 created, 2 updated, 1 skipped, 1 errors in \d+ms$/,
      );
    });

    it('rolls extra counters into the summary line', () => {
      const t = new SyncPhaseTracker(
        logger,
        'TestSync',
        ['p'] as const,
        'p',
        3,
      );
      t.item({
        name: 'A',
        externalId: 'a',
        outcomeLabel: 'status-only matched',
        outcome: 'skipped',
        extraCounters: ['status-only matched'],
      });
      t.item({
        name: 'B',
        externalId: 'b',
        outcomeLabel: 'status-only matched',
        outcome: 'skipped',
        extraCounters: ['status-only matched'],
      });
      log.mockClear();
      t.complete();
      expect(log.mock.calls[0][0]).toMatch(/2 status-only matched/);
    });
  });
});

describe('per-data-type factories', () => {
  let logger: Logger;
  let log: jest.Mock;

  beforeEach(() => {
    log = jest.fn();
    logger = { log } as unknown as Logger;
  });

  it('billSyncTracker tags with [BillSync] and uses bill phase list', () => {
    billSyncTracker(logger, 'extract_and_upsert', 2750);
    expect(log).toHaveBeenCalledWith(
      '[BillSync] Phase 2/6 (extract_and_upsert) starting: 2750 items',
    );
  });

  it('repSyncTracker tags with [RepSync]', () => {
    repSyncTracker(logger, 'bio_generation', 80);
    expect(log).toHaveBeenCalledWith(
      '[RepSync] Phase 4/5 (bio_generation) starting: 80 items',
    );
  });

  it('meetingSyncTracker tags with [MeetingSync]', () => {
    meetingSyncTracker(logger, 'extract_and_upsert', 36);
    expect(log).toHaveBeenCalledWith(
      '[MeetingSync] Phase 2/3 (extract_and_upsert) starting: 36 items',
    );
  });

  it('minutesSyncTracker tags with [MinutesSync]', () => {
    minutesSyncTracker(logger, 'ingest', 12);
    expect(log).toHaveBeenCalledWith(
      '[MinutesSync] Phase 2/3 (ingest) starting: 12 items',
    );
  });

  it('propositionSyncTracker tags with [PropositionSync]', () => {
    propositionSyncTracker(logger, 'analysis', 3);
    expect(log).toHaveBeenCalledWith(
      '[PropositionSync] Phase 3/3 (analysis) starting: 3 items',
    );
  });

  it('civicsSyncTracker tags with [CivicsSync]', () => {
    civicsSyncTracker(logger, 'discover', 1);
    expect(log).toHaveBeenCalledWith(
      '[CivicsSync] Phase 1/2 (discover) starting: 1 items',
    );
  });

  it('campaignFinanceSyncTracker tags with [CampaignFinanceSync]', () => {
    campaignFinanceSyncTracker(logger, 'extract_and_upsert', 5000);
    expect(log).toHaveBeenCalledWith(
      '[CampaignFinanceSync] Phase 2/2 (extract_and_upsert) starting: 5000 items',
    );
  });
});

describe('phase ordering invariants', () => {
  it('BILL_SYNC_PHASES matches syncBills orchestration order', () => {
    expect(BILL_SYNC_PHASES).toEqual([
      'discover',
      'extract_and_upsert',
      'votes_only',
      'stage_backfill',
      'prune_stale',
      'summarize',
    ]);
  });

  it('REP_SYNC_PHASES has the rep enrichment pipeline', () => {
    expect(REP_SYNC_PHASES).toEqual([
      'discover',
      'extract_and_upsert',
      'detail_crawl',
      'bio_generation',
      'prune_stale',
    ]);
  });

  it('MEETING_SYNC_PHASES includes minutes_link for the post-#814 path', () => {
    expect(MEETING_SYNC_PHASES).toEqual([
      'discover',
      'extract_and_upsert',
      'minutes_link',
    ]);
  });

  it('MINUTES_SYNC_PHASES is standalone — covers separate minutes ingest', () => {
    expect(MINUTES_SYNC_PHASES).toEqual(['discover', 'ingest', 'summarize']);
  });

  it('PROPOSITION_SYNC_PHASES includes the analysis pass', () => {
    expect(PROPOSITION_SYNC_PHASES).toEqual([
      'discover',
      'extract_and_upsert',
      'analysis',
    ]);
  });

  it('CIVICS_SYNC_PHASES is two phases — lifecycle taxonomy is simple', () => {
    expect(CIVICS_SYNC_PHASES).toEqual(['discover', 'extract_and_upsert']);
  });

  it('CAMPAIGN_FINANCE_SYNC_PHASES is two phases at minimum', () => {
    expect(CAMPAIGN_FINANCE_SYNC_PHASES).toEqual([
      'discover',
      'extract_and_upsert',
    ]);
  });
});

describe('duration formatter', () => {
  it('renders sub-second durations as `Nms`', () => {
    expect(__testing.formatDuration(0)).toBe('0ms');
    expect(__testing.formatDuration(843)).toBe('843ms');
    expect(__testing.formatDuration(999)).toBe('999ms');
  });

  it('renders sub-minute durations as `Ns`', () => {
    expect(__testing.formatDuration(1000)).toBe('1s');
    expect(__testing.formatDuration(23_456)).toBe('23.5s');
    expect(__testing.formatDuration(59_999)).toBe('60s');
  });

  it('renders sub-hour durations as `NmMs`', () => {
    expect(__testing.formatDuration(60_000)).toBe('1m0s');
    expect(__testing.formatDuration(14 * 60_000 + 23_000)).toBe('14m23s');
    expect(__testing.formatDuration(3_599_000)).toBe('59m59s');
  });

  it('renders multi-hour durations as `NhMm`', () => {
    expect(__testing.formatDuration(3_600_000)).toBe('1h0m');
    expect(__testing.formatDuration(14 * 3_600_000 + 23 * 60_000)).toBe(
      '14h23m',
    );
    expect(__testing.formatDuration(25 * 3_600_000)).toBe('25h0m');
  });
});

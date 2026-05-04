/* eslint-disable @typescript-eslint/no-explicit-any */
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';

interface MinutesRow {
  id: string;
  externalId: string;
  body: string;
  date: Date;
  isActive: boolean;
  rawText: string | null;
}

interface RepRow {
  id: string;
  lastName: string | null;
  chamber: string | null;
}

interface PropositionRow {
  id: string;
  externalId: string;
}

interface CommitteeRow {
  id: string;
  externalId: string;
}

const buildLinker = (opts: {
  minutes: MinutesRow[];
  reps?: RepRow[];
  propositions?: PropositionRow[];
  committees?: CommitteeRow[];
}) => {
  const reps = opts.reps ?? [];
  const propositions = opts.propositions ?? [];
  const committees = opts.committees ?? [];
  const persistedActions: any[] = [];

  const db = {
    minutes: {
      findMany: jest.fn(async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? [];
        return opts.minutes.filter(
          (m) =>
            ids.includes(m.id) && (args.where?.isActive ? m.isActive : true),
        );
      }),
    },
    representative: {
      findMany: jest.fn(async () => reps),
    },
    proposition: {
      findMany: jest.fn(async () => propositions),
    },
    legislativeCommittee: {
      findMany: jest.fn(async () => committees),
    },
    legislativeAction: {
      deleteMany: jest.fn(async (args: any) => {
        for (let i = persistedActions.length - 1; i >= 0; i--) {
          if (persistedActions[i].minutesId === args.where.minutesId) {
            persistedActions.splice(i, 1);
          }
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async (args: any) => {
        for (const r of args.data) persistedActions.push(r);
        return { count: args.data.length };
      }),
    },
    $transaction: jest.fn(async (ops: any[]) => {
      for (const op of ops) await op;
    }),
  };

  // The committee-linker dependency is used only for `externalIdFor`.
  // Constructor signature is (config?, db?); pass a stub ConfigService so
  // its constructor's `readPositiveInt` doesn't blow up on undefined.get.
  const committeeLinker = new LegislativeCommitteeLinkerService(
    { get: jest.fn().mockReturnValue(undefined) } as any,
    db as any,
  );

  const linker = new LegislativeActionLinkerService(db as any, committeeLinker);

  return { linker, db, persistedActions };
};

describe('LegislativeActionLinkerService', () => {
  const FIXTURE_RAWTEXT = [
    'Tuesday, April 28, 2026',
    '',
    'ROLLCALL',
    'The following members answered the morning rollcall — 3:',
    'Aguiar-Curry',
    'Bauer-Kahan',
    'Mr. Speaker',
    '',
    'LEAVES OF ABSENCE FOR THE DAY',
    'Legislative business: Members Garcia and Lee.',
    'Illness: Members Smith.',
    '',
    'REPORTS OF STANDING COMMITTEES',
    'Committee on Public Safety',
    'Date of Hearing: April 21, 2026',
    'Your Committee on Public Safety reports:',
    'Assembly Bill No. 1897',
    'With the recommendation: Do pass.',
    'Above bill correctly engrossed.',
    'JONES, Chair',
    '',
    'SECOND READING OF ASSEMBLY BILLS',
    'ASSEMBLY BILL NO. 500',
    'Bill read second time, and amendments proposed by the Committee on Judiciary read and adopted.',
  ].join('\n');

  it('skips Minutes with empty rawText and reports 0 actions', async () => {
    const { linker } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: null,
        },
      ],
    });
    const result = await linker.linkMinutes(['m-1']);
    // "Processed" counts rows examined; an empty rawText still gets
    // examined, just produces no action rows.
    expect(result.actionsCreated).toBe(0);
  });

  it('extracts presence rolls (yes) from the rollcall block, including Mr. Speaker', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
    });

    await linker.linkMinutes(['m-1']);

    const presence = persistedActions.filter(
      (a) => a.actionType === 'presence' && a.position === 'yes',
    );
    expect(presence.length).toBeGreaterThanOrEqual(3);
    const subjects = presence.map((a) => a.rawSubject);
    expect(subjects).toContain('Aguiar-Curry');
    expect(subjects).toContain('Bauer-Kahan');
    expect(subjects).toContain('Mr. Speaker');
  });

  it('extracts absence records and resolves single-match surnames to representatives', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
      reps: [
        { id: 'rep-garcia', lastName: 'Garcia', chamber: 'Assembly' },
        { id: 'rep-smith', lastName: 'Smith', chamber: 'Assembly' },
        // Note: NO 'Lee' rep — leaves a null FK + rawSubject for the UI.
      ],
    });

    await linker.linkMinutes(['m-1']);

    const absent = persistedActions.filter(
      (a) => a.actionType === 'presence' && a.position === 'absent',
    );
    expect(absent.length).toBe(3); // Garcia, Lee, Smith
    const resolved = absent.find((a) => a.rawSubject === 'Garcia');
    expect(resolved?.representativeId).toBe('rep-garcia');
    const unresolved = absent.find((a) => a.rawSubject === 'Lee');
    expect(unresolved?.representativeId).toBeNull();
    expect(unresolved?.rawSubject).toBe('Lee');
  });

  it('records committee_hearing actions with date attribution + committee FK resolution', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
      committees: [
        { id: 'cmt-public-safety', externalId: 'assembly:public safety' },
        { id: 'cmt-judiciary', externalId: 'assembly:judiciary' },
      ],
    });

    await linker.linkMinutes(['m-1']);

    const hearings = persistedActions.filter(
      (a) => a.actionType === 'committee_hearing',
    );
    expect(hearings).toHaveLength(1);
    expect(hearings[0].rawSubject).toBe('Public Safety');
    expect(hearings[0].committeeId).toBe('cmt-public-safety');
    expect(hearings[0].text).toMatch(/April 21, 2026/);
  });

  it('emits an amendment action when a committee floor amendment is read and adopted', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
      committees: [{ id: 'cmt-judiciary', externalId: 'assembly:judiciary' }],
    });

    await linker.linkMinutes(['m-1']);

    const amendments = persistedActions.filter(
      (a) => a.actionType === 'amendment',
    );
    expect(amendments.length).toBeGreaterThanOrEqual(1);
    expect(amendments[0].committeeId).toBe('cmt-judiciary');
    expect(amendments[0].rawSubject).toBe('Committee on Judiciary');
  });

  it('emits engrossment actions and links bill citations to propositions', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
      propositions: [{ id: 'prop-ab1897', externalId: 'AB 1897' }],
    });

    await linker.linkMinutes(['m-1']);

    const engrossments = persistedActions.filter(
      (a) => a.actionType === 'engrossment',
    );
    expect(engrossments.length).toBeGreaterThanOrEqual(1);
    const ab1897 = engrossments.find((a) => a.rawSubject === 'AB 1897');
    expect(ab1897).toBeDefined();
    expect(ab1897!.propositionId).toBe('prop-ab1897');
  });

  it('every action carries valid passage offsets into the source rawText', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
    });

    await linker.linkMinutes(['m-1']);

    expect(persistedActions.length).toBeGreaterThan(0);
    for (const a of persistedActions) {
      expect(a.passageStart).toBeGreaterThanOrEqual(0);
      expect(a.passageEnd).toBeGreaterThan(a.passageStart);
      expect(a.passageEnd).toBeLessThanOrEqual(FIXTURE_RAWTEXT.length);
    }
  });

  it('mints unique externalIds per action with the parent minutes prefix', async () => {
    const { linker, persistedActions } = buildLinker({
      minutes: [
        {
          id: 'm-1',
          externalId: 'ca-2026-04-28',
          body: 'Assembly',
          date: new Date('2026-04-28T00:00:00Z'),
          isActive: true,
          rawText: FIXTURE_RAWTEXT,
        },
      ],
    });
    await linker.linkMinutes(['m-1']);
    const ids = new Set(persistedActions.map((a) => a.externalId));
    expect(ids.size).toBe(persistedActions.length);
    for (const id of ids) {
      expect(id).toMatch(/^ca-2026-04-28-\d{4}$/);
    }
  });
});

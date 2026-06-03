import {
  isBillDead,
  isBillActive,
  BillLifecycleInput,
  computeActiveCaSessionYears,
} from './bill-lifecycle';

const ctx = {
  today: new Date(Date.UTC(2026, 4, 31)), // 2026-05-31
  activeSessionYears: ['2025-2026'],
};

function bill(overrides: Partial<BillLifecycleInput> = {}): BillLifecycleInput {
  return {
    status: null,
    currentStageId: null,
    sessionYear: '2025-2026',
    lastAction: null,
    lastActionDate: null,
    ...overrides,
  };
}

describe('isBillDead', () => {
  describe('terminal lifecycle stage', () => {
    it('flags failed-passage as dead', () => {
      expect(isBillDead(bill({ currentStageId: 'failed-passage' }), ctx)).toBe(
        true,
      );
    });

    it('does NOT flag chaptered as dead (passed ≠ dead)', () => {
      expect(
        isBillDead(
          bill({ currentStageId: 'chaptered', sessionYear: '2023-2024' }),
          ctx,
        ),
      ).toBe(false);
    });

    it('does not flag mid-pipeline stages', () => {
      expect(isBillDead(bill({ currentStageId: 'first-committee' }), ctx)).toBe(
        false,
      );
    });
  });

  describe('status string patterns', () => {
    it.each([
      ['Vetoed'],
      ['Failed Deadline'],
      ['Inactive File'],
      ['Withdrawn'],
      ['Failed Passage'],
      ['Died'],
      ['Inactive Bill - Died'], // CA verbatim form
      ['Inactive Bill - Vetoed'], // CA verbatim form
      ['Sen Inactive File - Assembly Bills'], // CA inactive-file variant
    ])('flags %s', (status) => {
      expect(isBillDead(bill({ status }), ctx)).toBe(true);
    });

    it.each([
      ['Chaptered'],
      ['Inactive Bill - Chaptered'], // CA verbatim form — passed, not dead
      ['Active Bill - In Committee Process'],
      ['Active Bill - Pending Referral'],
    ])('does NOT flag live or chaptered status %s', (status) => {
      expect(isBillDead(bill({ status }), ctx)).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isBillDead(bill({ status: 'vetoed' }), ctx)).toBe(true);
    });

    it('does not flag unrelated statuses', () => {
      expect(isBillDead(bill({ status: 'Active Bill - Engrossed' }), ctx)).toBe(
        false,
      );
    });

    it('does not flag when status is null', () => {
      expect(isBillDead(bill({ status: null }), ctx)).toBe(false);
    });
  });

  describe('veto override exception', () => {
    it('does NOT flag a vetoed bill whose lastAction mentions an override', () => {
      expect(
        isBillDead(
          bill({
            status: 'Vetoed',
            lastAction: 'Veto overridden by Assembly',
          }),
          ctx,
        ),
      ).toBe(false);
    });

    it('still flags a vetoed bill with no override action', () => {
      expect(
        isBillDead(
          bill({
            status: 'Vetoed',
            lastAction: 'Vetoed by Governor',
          }),
          ctx,
        ),
      ).toBe(true);
    });
  });

  describe('session expired', () => {
    it('flags bills from a closed session', () => {
      expect(isBillDead(bill({ sessionYear: '2023-2024' }), ctx)).toBe(true);
    });

    it('does not flag bills from the active session', () => {
      expect(isBillDead(bill({ sessionYear: '2025-2026' }), ctx)).toBe(false);
    });

    it('does not flag chaptered bills from a closed session', () => {
      expect(
        isBillDead(
          bill({ sessionYear: '2023-2024', currentStageId: 'chaptered' }),
          ctx,
        ),
      ).toBe(false);
    });
  });

  describe('carryover guard', () => {
    it('keeps a sessionYear-expired bill live if its lastActionDate is this year', () => {
      // Two-year CA session: a bill labelled with a closed session label but
      // with activity this year is a carryover and remains live.
      expect(
        isBillDead(
          bill({
            sessionYear: '2023-2024',
            lastActionDate: new Date(Date.UTC(2026, 2, 1)),
          }),
          ctx,
        ),
      ).toBe(false);
    });

    it('does NOT save a bill with a terminal status, even with a same-year action date', () => {
      // Hard signals (Vetoed/Died/etc.) win over the carryover heuristic —
      // the carryover guard only protects against the soft session-expired
      // rule, not against an authoritative dead status. Real-world: a bill
      // that died on 2026-02-03 is still dead even though 2026 == today's
      // year.
      expect(
        isBillDead(
          bill({
            status: 'Inactive Bill - Died',
            lastActionDate: new Date(Date.UTC(2026, 1, 3)),
          }),
          ctx,
        ),
      ).toBe(true);
    });

    it('flags a closed-session bill whose last action was last year', () => {
      expect(
        isBillDead(
          bill({
            sessionYear: '2023-2024',
            lastActionDate: new Date(Date.UTC(2025, 11, 15)),
          }),
          ctx,
        ),
      ).toBe(true);
    });
  });

  describe('default — clean active bill', () => {
    it('returns false for a fresh active-session bill with no terminal signals', () => {
      expect(
        isBillDead(
          bill({
            status: 'Active Bill - In Committee Process',
            currentStageId: 'first-committee',
            lastActionDate: new Date(Date.UTC(2026, 4, 1)),
          }),
          ctx,
        ),
      ).toBe(false);
    });
  });
});

describe('isBillActive', () => {
  it.each([
    ['Active Bill - In Committee Process'],
    ['Active Bill - Pending Referral'],
    ['Active Bill - In Floor Process'],
  ])('returns true for active prefix: %s', (status) => {
    expect(isBillActive(bill({ status }), ctx)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      isBillActive(bill({ status: 'active bill - in committee process' }), ctx),
    ).toBe(true);
  });

  it.each([
    ['Chaptered'],
    ['Inactive Bill - Chaptered'],
    ['Inactive Bill - Died'],
    ['Inactive Bill - Vetoed'],
    ['Sen Inactive File - Assembly Bills'],
    ['Ordered to inactive file at the request of Senator Blakespear.'],
  ])('returns false for inactive status %s', (status) => {
    expect(isBillActive(bill({ status }), ctx)).toBe(false);
  });

  it('returns false for null status', () => {
    expect(isBillActive(bill({ status: null }), ctx)).toBe(false);
  });

  it('does not flag a status that merely contains "active" elsewhere', () => {
    // Defensive — only the leading-prefix counts, not the substring.
    expect(
      isBillActive(bill({ status: 'Inactive Bill - Active referral' }), ctx),
    ).toBe(false);
  });

  it('returns false when the prefix matches but the bill is dead — partition invariant (#747)', () => {
    // Stale "Active Bill - ..." status on an expired-session bill: prefix
    // satisfies the substring rule, but isBillDead returns true via the
    // session-expired path. isBillActive must defer to isBillDead so the
    // 3-way partition stays airtight — no bill can be both active and dead.
    expect(
      isBillActive(
        bill({
          status: 'Active Bill - In Committee Process',
          sessionYear: '2023-2024',
          lastActionDate: new Date(Date.UTC(2024, 5, 1)),
        }),
        ctx,
      ),
    ).toBe(false);
  });
});

describe('computeActiveCaSessionYears', () => {
  it.each([
    [new Date(Date.UTC(2025, 0, 1)), '2025-2026'],
    [new Date(Date.UTC(2026, 5, 30)), '2025-2026'],
    [new Date(Date.UTC(2026, 11, 31)), '2025-2026'],
    [new Date(Date.UTC(2027, 0, 1)), '2027-2028'],
    [new Date(Date.UTC(2028, 11, 31)), '2027-2028'],
  ])('resolves %s → %s', (today, expected) => {
    expect(computeActiveCaSessionYears(today)).toEqual([expected]);
  });
});

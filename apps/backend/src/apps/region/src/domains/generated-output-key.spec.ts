import {
  inputHash,
  outputCurrency,
  outputSkipKey,
  partitionStale,
  type LiveOutputKey,
  type StoredOutputKey,
} from './generated-output-key';

const live: LiveOutputKey = {
  promptHash: 'p'.repeat(64),
  modelDigest: 'sha256:weights-a',
  sourceHash: inputHash('Name: Jane Doe\nDistrict: 4'),
  configHash: 'c'.repeat(64),
};
const current: StoredOutputKey = {
  promptHash: live.promptHash!,
  llmDigest: live.modelDigest!,
  sourceHash: live.sourceHash,
  configHash: live.configHash,
};

describe('outputCurrency (representatives Phase B skip key)', () => {
  it('is current when every axis matches', () => {
    expect(outputCurrency(current, live)).toBe('current');
  });

  it.each([
    ['prompt', { promptHash: 'q'.repeat(64) }],
    ['weights', { llmDigest: 'sha256:weights-b' }],
    ['input', { sourceHash: inputHash('Name: Jane Doe\nDistrict: 5') }],
    ['config', { configHash: 'd'.repeat(64) }],
  ])('is stale on a different %s', (_axis, change) => {
    expect(outputCurrency({ ...current, ...change }, live)).toBe('stale');
  });

  it('is stale when never attributed (pre-#1149, or never produced)', () => {
    expect(outputCurrency({ ...current, promptHash: null }, live)).toBe(
      'stale',
    );
  });

  it('is legacy — stamped, not regenerated — when only the new axes are missing', () => {
    expect(
      outputCurrency({ ...current, sourceHash: null, configHash: null }, live),
    ).toBe('legacy');
  });

  it('is stale, not legacy, when a legacy row is on old weights', () => {
    expect(
      outputCurrency(
        {
          ...current,
          sourceHash: null,
          configHash: null,
          llmDigest: 'sha256:weights-b',
        },
        live,
      ),
    ).toBe('stale');
  });

  it('leaves an axis unchecked when its live value could not be resolved', () => {
    // One failed lookup must not regenerate every output.
    expect(
      outputCurrency(
        { ...current, llmDigest: 'sha256:weights-b' },
        { ...live, modelDigest: undefined },
      ),
    ).toBe('current');
    expect(
      outputCurrency(
        { ...current, promptHash: 'q'.repeat(64) },
        { ...live, promptHash: undefined },
      ),
    ).toBe('current');
  });

  it.each([
    ['config only', { configHash: null }],
    ['input only', { sourceHash: null }],
  ])(
    'is stale, not legacy, when %s is missing — legacy is both new axes absent',
    (_case, missing) => {
      expect(outputCurrency({ ...current, ...missing }, live)).toBe('stale');
    },
  );
});

describe('partitionStale', () => {
  const assessed = (currency: 'current' | 'legacy' | 'stale') => ({
    live,
    currency,
  });

  it('caps the stale rows in row order, counts the rest, and stamps legacy rows', async () => {
    const stamp = jest.fn().mockResolvedValue(undefined);
    const rows = ['s1', 'c1', 's2', 'l1', 's3', 'skip'];
    const kind: Record<string, 'current' | 'legacy' | 'stale' | undefined> = {
      s1: 'stale',
      c1: 'current',
      s2: 'stale',
      l1: 'legacy',
      s3: 'stale',
      skip: undefined,
    };

    const { pending, current: n } = await partitionStale(rows, {
      assess: async (row) => (kind[row] ? assessed(kind[row]!) : undefined),
      stamp,
      target: (row, key) => ({ id: row, key }),
      cap: 2,
    });

    expect(pending.map((t) => t.id)).toEqual(['s1', 's2']);
    expect(n).toBe(2);
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stamp).toHaveBeenCalledWith('l1', live);
  });

  it('keeps row order across assessment chunks', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const { pending } = await partitionStale(rows, {
      // Later rows resolve first: order must come from the rows, not timing.
      assess: (row) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(assessed('stale')),
            20 - Number(row.slice(1)),
          ),
        ),
      stamp: jest.fn(),
      target: (row, key) => ({ id: row, key }),
    });

    expect(pending.map((t) => t.id)).toEqual(rows);
  });
});

describe('outputSkipKey', () => {
  it('names the same job for the same inputs, a different one otherwise', () => {
    expect(outputSkipKey(live)).toBe(outputSkipKey({ ...live }));
    expect(outputSkipKey(live)).not.toBe(
      outputSkipKey({ ...live, sourceHash: inputHash('other') }),
    );
  });

  it('is null — a one-off job — when the prompt hash or digest is unknown', () => {
    expect(outputSkipKey({ ...live, promptHash: undefined })).toBeNull();
    expect(outputSkipKey({ ...live, modelDigest: undefined })).toBeNull();
  });
});

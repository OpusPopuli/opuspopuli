import { FixedWindowThrottlerStorage } from './fixed-window-storage';

/** A store on a clock the test moves by hand. */
function storeAt(start = 1_000_000, maxKeys?: number) {
  const clock = { now: start };
  const store = new FixedWindowThrottlerStorage(maxKeys, () => clock.now);
  const hit = (key: string, limit = 3, ttl = 1000, block = 1000) =>
    store.increment(key, ttl, limit, block, 'short');
  return { clock, store, hit };
}

describe('FixedWindowThrottlerStorage (#1456)', () => {
  it('counts hits in a window and blocks past the limit', async () => {
    const { hit } = storeAt();
    for (let i = 1; i <= 3; i++) {
      expect(await hit('a')).toMatchObject({ totalHits: i, isBlocked: false });
    }
    expect(await hit('a')).toMatchObject({
      isBlocked: true,
      timeToBlockExpire: 1,
    });
  });

  it('stays blocked for the block duration, then starts a fresh window', async () => {
    const { clock, hit } = storeAt();
    for (let i = 0; i < 4; i++) await hit('a', 3, 1000, 5000);
    clock.now += 2000; // the window is over, the block is not
    expect((await hit('a', 3, 1000, 5000)).isBlocked).toBe(true);
    clock.now += 3000;
    expect(await hit('a', 3, 1000, 5000)).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it("never lets one client's expiring block affect another's count", async () => {
    // The stock store's defect: B's block lapsing cleared A's decay timers,
    // so A climbed to the limit on ordinary traffic.
    const { clock, hit } = storeAt();
    for (let i = 0; i < 10; i++) await hit('b'); // b is blocked
    await hit('a');
    await hit('a');
    clock.now += 1000; // both windows and b's block end
    await hit('b'); // b's block lapses here
    for (let i = 1; i <= 3; i++) {
      expect(await hit('a')).toMatchObject({ totalHits: i, isBlocked: false });
    }
  });

  it('keeps each key separate', async () => {
    const { hit } = storeAt();
    for (let i = 0; i < 4; i++) await hit('a');
    expect(await hit('b')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('forgets expired windows, so distinct clients do not accumulate', async () => {
    const { clock, store, hit } = storeAt();
    for (let i = 0; i < 999; i++) await hit(`ip-${i}`);
    expect(store.size).toBe(999);
    clock.now += 2000;
    await hit('late'); // the 1,000th increment sweeps
    expect(store.size).toBe(1);
  });

  it('drops the oldest keys beyond its bound', async () => {
    const { store, hit } = storeAt(1_000_000, 3);
    for (const key of ['a', 'b', 'c', 'd']) await hit(key);
    expect(store.size).toBe(3);
    // 'a' was dropped: it starts again from zero rather than being refused.
    expect(await hit('a')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('reports times in whole seconds, as the throttler expects', async () => {
    const { hit } = storeAt();
    expect(await hit('a', 3, 60_000)).toMatchObject({ timeToExpire: 60 });
  });
});

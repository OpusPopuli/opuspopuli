import { Logger } from '@nestjs/common';
import { RegionPluginService } from './region-plugin.service';

/**
 * S1 — the region configs' declared fetch rates reach the per-host limiter
 * (`docs/plans/S1-per-host-rate-limiter.md`).
 *
 * Region configs declared a `rateLimit` long before anything read it, so
 * the FEC API (quota ≈ 0.28 rps; federal.json asks 0.25) was fetched with no
 * per-host limit at all. These tests pin that the declared rates are what
 * gets published, that every plugin reload republishes them, and that the
 * hourly republish keeps them alive between loads.
 */
describe('RegionPluginService — host rate policies (S1)', () => {
  const federal = {
    getRateLimit: () => ({ requestsPerSecond: 0.25, burstSize: 1 }),
    getDataSources: () => [
      { url: 'https://api.open.fec.gov/v1/schedules/schedule_a/' },
      { url: 'https://www.fec.gov/files/bulk-downloads/' },
    ],
  };
  const california = {
    getRateLimit: () => ({ requestsPerSecond: 1, burstSize: 3 }),
    getDataSources: () => [
      {
        url: 'https://leginfo.legislature.ca.gov/faces/billSearchClient.xhtml',
      },
      { url: 'https://oag.ca.gov/initiatives', rateLimitOverride: 0.5 },
    ],
    getName: () => 'california',
    getRegionInfo: () => ({ id: 'california', name: 'California' }),
  };

  // Every publish arms the hourly republish; clear it so no test leaks it.
  let built: RegionPluginService[] = [];

  const build = (limiter?: { acquire: jest.Mock; setPolicies: jest.Mock }) => {
    const registry = {
      getAll: jest
        .fn()
        .mockReturnValue([{ instance: federal }, { instance: california }]),
      unregister: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(california),
      getFederal: jest.fn().mockReturnValue(federal),
      hasActive: jest.fn().mockReturnValue(true),
      registerLocal: jest.fn(),
      replaceLocal: jest.fn().mockResolvedValue(undefined),
    };
    const loader = {
      loadPlugin: jest.fn().mockResolvedValue(undefined),
      buildPlugin: jest.fn().mockReturnValue(california),
    };
    const db = {
      regionPlugin: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { name: 'california', config: {}, parentRegionId: null },
          ]),
      },
    };
    const service = new RegionPluginService(
      loader as never,
      registry as never,
      db as never,
      undefined,
      undefined,
      limiter as never,
    );
    built.push(service);
    return { service, registry, db };
  };

  const publish = (service: RegionPluginService) =>
    (
      service as unknown as { publishHostRatePolicies: () => Promise<void> }
    ).publishHostRatePolicies();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    built.forEach((s) => s.onModuleDestroy());
    built = [];
    jest.restoreAllMocks();
  });

  it("publishes each loaded region's declared rates, per host", async () => {
    const limiter = { acquire: jest.fn(), setPolicies: jest.fn() };
    const { service } = build(limiter);

    await publish(service);

    const policies = limiter.setPolicies.mock.calls[0][0] as Map<
      string,
      { requestsPerSecond: number; burstSize: number }
    >;
    expect(Object.fromEntries(policies)).toEqual({
      'api.open.fec.gov': { requestsPerSecond: 0.25, burstSize: 1 },
      'www.fec.gov': { requestsPerSecond: 0.25, burstSize: 1 },
      'leginfo.legislature.ca.gov': { requestsPerSecond: 1, burstSize: 3 },
      // The source override sets the rate; the burst stays the region's.
      'oag.ca.gov': { requestsPerSecond: 0.5, burstSize: 3 },
    });
  });

  it('republishes on every plugin reload', async () => {
    // The admin toggle and the recovery mutation both reload; a reload that
    // skipped publishing would leave a newly enabled region at the default.
    const limiter = { acquire: jest.fn(), setPolicies: jest.fn() };
    const { service } = build(limiter);

    await service.refreshActiveLocalPlugin();

    expect(limiter.setPolicies).toHaveBeenCalledTimes(1);
  });

  it('republishes hourly, once scheduled, and stops on destroy', async () => {
    // Loads are rare — a node runs for weeks between them — so a publish that
    // failed at boot, or policies lost with Redis's data, would otherwise
    // leave the FEC host on the default until the next deploy.
    jest.useFakeTimers();
    try {
      const limiter = { acquire: jest.fn(), setPolicies: jest.fn() };
      const { service, db } = build(limiter);
      await service.refreshActiveLocalPlugin();
      // A changed row, so the second refresh reloads (an unchanged one is
      // skipped, S2) — and must not add a 2nd timer.
      db.regionPlugin.findMany.mockResolvedValue([
        { name: 'california', config: { v: 2 }, parentRegionId: null },
      ]);
      await service.refreshActiveLocalPlugin();

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(limiter.setPolicies).toHaveBeenCalledTimes(3);

      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(limiter.setPolicies).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('warns about an invalid configured rate instead of publishing it', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const limiter = { acquire: jest.fn(), setPolicies: jest.fn() };
    const { service, registry } = build(limiter);
    registry.getAll.mockReturnValue([
      {
        instance: {
          getRateLimit: () => ({ requestsPerSecond: 0, burstSize: 1 }),
          getDataSources: () => [{ url: 'https://bad.example.gov/x' }],
        },
      },
    ]);

    await publish(service);

    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('bad.example.gov')),
    ).toBe(true);
    const policies = limiter.setPolicies.mock.calls[0][0] as Map<
      string,
      { requestsPerSecond: number }
    >;
    // Rate 0 would have hung every fetch to that host; it gets the default.
    expect(policies.get('bad.example.gov')?.requestsPerSecond).toBe(2);
  });

  it('runs without a limiter bound, as every sync did before S1', async () => {
    const { service } = build(undefined);

    await expect(service.refreshActiveLocalPlugin()).resolves.toBeUndefined();
  });
});

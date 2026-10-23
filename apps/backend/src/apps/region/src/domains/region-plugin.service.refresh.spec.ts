import { Logger } from '@nestjs/common';
import { RegionPluginService } from './region-plugin.service';

/**
 * S2 — the plugin refresh every sync runs (`docs/plans/S2-per-type-sync-jobs.md`).
 *
 * `syncAll` refreshes the local plugins at the start of every job. With syncs
 * now concurrent in one process, a refresh must neither empty the registry
 * under a running sync nor rebuild what has not changed.
 */
describe('RegionPluginService.refreshActiveLocalPlugin (S2)', () => {
  const california = {
    getName: () => 'california',
    getRegionInfo: () => ({ id: 'california', name: 'California' }),
    getRateLimit: () => undefined,
    getDataSources: () => [],
  };
  let built: RegionPluginService[] = [];

  const build = () => {
    const registry = {
      getAll: jest.fn().mockReturnValue([{ instance: california }]),
      unregister: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(california),
      getFederal: jest.fn().mockReturnValue(undefined),
      hasActive: jest.fn().mockReturnValue(true),
      registerLocal: jest.fn(),
      replaceLocal: jest.fn().mockResolvedValue(undefined),
    };
    const loader = { buildPlugin: jest.fn().mockReturnValue(california) };
    const rows = [
      { name: 'california', config: { v: 1 }, parentRegionId: null },
    ];
    const db = {
      regionPlugin: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new RegionPluginService(
      loader as never,
      registry as never,
      db as never,
    );
    built.push(service);
    return { service, registry, db };
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    built.forEach((s) => s.onModuleDestroy());
    built = [];
    jest.restoreAllMocks();
  });

  it('replaces the plugins in one swap, never emptying the registry first', async () => {
    const { service, registry } = build();

    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(1);
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('skips the rebuild when the enabled plugin rows are unchanged', async () => {
    const { service, registry } = build();

    await service.refreshActiveLocalPlugin();
    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when a row changed — an admin toggle', async () => {
    const { service, registry, db } = build();
    await service.refreshActiveLocalPlugin();

    db.regionPlugin.findMany.mockResolvedValue([
      { name: 'california', config: { v: 2 }, parentRegionId: null },
    ]);
    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when nothing is active, however the rows compare', async () => {
    const { service, registry } = build();
    await service.refreshActiveLocalPlugin();

    registry.hasActive.mockReturnValue(false);
    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when forced — the recovery mutation and admin toggles', async () => {
    const { service, registry } = build();
    await service.refreshActiveLocalPlugin();

    await service.refreshActiveLocalPlugin(true);

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });

  it('retries a load where a plugin failed, rather than remembering it as done', async () => {
    const { service, registry } = build();
    // The row's plugin did not come up (it initialised with an error, or
    // only the fallback is active).
    registry.getLocal.mockImplementation((name?: string) =>
      name ? undefined : california,
    );
    await service.refreshActiveLocalPlugin();

    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when forced — the recovery mutation and admin toggles', async () => {
    const { service, registry } = build();
    await service.refreshActiveLocalPlugin();

    await service.refreshActiveLocalPlugin(true);

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });

  it('retries a load where a plugin failed, rather than remembering it as done', async () => {
    const { service, registry } = build();
    // The row's plugin did not come up (it initialised with an error, or
    // only the fallback is active).
    registry.getLocal.mockImplementation((name?: string) =>
      name ? undefined : california,
    );
    await service.refreshActiveLocalPlugin();

    await service.refreshActiveLocalPlugin();

    expect(registry.replaceLocal).toHaveBeenCalledTimes(2);
  });
});

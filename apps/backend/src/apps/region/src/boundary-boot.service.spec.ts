import type { BoundaryLoaderService } from './domains/boundary-loader.service';
import { BoundaryBootService } from './boundary-boot.service';

describe('BoundaryBootService (#1475)', () => {
  const loader = { loadAll: jest.fn() };
  const service = new BoundaryBootService(
    loader as unknown as BoundaryLoaderService,
  );

  afterEach(() => {
    delete process.env.FORCE_RELOAD_BOUNDARIES;
    loader.loadAll.mockReset();
  });

  it('starts the load in the background and returns synchronously', async () => {
    loader.loadAll.mockResolvedValue({
      ok: true,
      counts: { existing: 0, upserted: 0, failed: 0, missingKey: 0 },
    });

    service.onApplicationBootstrap();

    expect(loader.loadAll).toHaveBeenCalledTimes(1);
    expect(loader.loadAll).toHaveBeenCalledWith();
    await Promise.resolve();
  });

  it('catches a thrown load so it never crashes Nest bootstrap', async () => {
    const error = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => {});
    loader.loadAll.mockRejectedValue(new Error('catastrophic'));

    service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));

    expect(error).toHaveBeenCalledWith(expect.stringContaining('catastrophic'));
  });

  it('respects FORCE_RELOAD_BOUNDARIES=skip-boot', () => {
    process.env.FORCE_RELOAD_BOUNDARIES = 'skip-boot';

    service.onApplicationBootstrap();

    expect(loader.loadAll).not.toHaveBeenCalled();
  });
});

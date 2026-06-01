// Mock the secrets-provider hydration call so tests don't reach for a
// real Vault. We assert call shape directly.
jest.mock('@opuspopuli/secrets-provider', () => ({
  hydrateEnvFromVault: jest.fn().mockResolvedValue(undefined),
}));

// Mock the shared bootstrap so runService doesn't actually spin up a
// NestJS app — we only verify the wiring.
jest.mock('./bootstrap', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));

import { hydrateEnvFromVault } from '@opuspopuli/secrets-provider';
import bootstrap from './bootstrap';
import {
  VAULT_BACKED_SECRETS,
  preflightAndLoad,
  runService,
} from './preflight';

const mockHydrate = hydrateEnvFromVault as jest.MockedFunction<
  typeof hydrateEnvFromVault
>;
const mockBootstrap = bootstrap as jest.MockedFunction<typeof bootstrap>;

describe('preflightAndLoad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls hydrateEnvFromVault with the canonical VAULT_BACKED_SECRETS list', async () => {
    const loader = jest.fn().mockResolvedValue({ ok: true });

    await preflightAndLoad(loader);

    expect(mockHydrate).toHaveBeenCalledTimes(1);
    expect(mockHydrate).toHaveBeenCalledWith(VAULT_BACKED_SECRETS);
  });

  it('invokes the loader AFTER hydration completes (ordering enforced)', async () => {
    const callOrder: string[] = [];
    mockHydrate.mockImplementationOnce(async () => {
      callOrder.push('hydrate');
    });
    const loader = jest.fn().mockImplementation(async () => {
      callOrder.push('load');
      return { ok: true };
    });

    await preflightAndLoad(loader);

    expect(callOrder).toEqual(['hydrate', 'load']);
  });

  it("returns the loader's resolved value", async () => {
    const expected = { AppModule: class FakeAppModule {} };
    const loader = jest.fn().mockResolvedValue(expected);

    await expect(preflightAndLoad(loader)).resolves.toBe(expected);
  });

  it('propagates loader rejection so callers can handle it', async () => {
    const loader = jest.fn().mockRejectedValue(new Error('module load failed'));

    await expect(preflightAndLoad(loader)).rejects.toThrow(
      'module load failed',
    );
  });
});

describe('runService', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Record process.exit() calls without throwing — the runService
    // chain has nothing after exit() so silent no-op is fine, and a
    // throw here would unhandled-reject inside .catch() and abort the
    // test runner.
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  const flushMicrotasks = () => new Promise((r) => setImmediate(r));

  it('runs preflight then bootstrap with the loaded AppModule', async () => {
    class FakeAppModule {}
    const loader = jest.fn().mockResolvedValue({ AppModule: FakeAppModule });

    runService(loader, { portEnvVar: 'TEST_PORT' });
    await flushMicrotasks();

    expect(mockHydrate).toHaveBeenCalledWith(VAULT_BACKED_SECRETS);
    expect(mockBootstrap).toHaveBeenCalledWith(FakeAppModule, {
      portEnvVar: 'TEST_PORT',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('catches preflight errors and exits with code 1', async () => {
    mockHydrate.mockRejectedValueOnce(new Error('vault unreachable'));
    const loader = jest.fn();

    runService(loader, { portEnvVar: 'TEST_PORT' });
    await flushMicrotasks();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockBootstrap).not.toHaveBeenCalled();
  });

  it('catches loader errors and exits with code 1', async () => {
    const loader = jest.fn().mockRejectedValue(new Error('module load failed'));

    runService(loader, { portEnvVar: 'TEST_PORT' });
    await flushMicrotasks();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockBootstrap).not.toHaveBeenCalled();
  });

  it('catches bootstrap errors and exits with code 1', async () => {
    class FakeAppModule {}
    const loader = jest.fn().mockResolvedValue({ AppModule: FakeAppModule });
    mockBootstrap.mockRejectedValueOnce(new Error('NestFactory failed'));

    runService(loader, { portEnvVar: 'TEST_PORT' });
    await flushMicrotasks();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

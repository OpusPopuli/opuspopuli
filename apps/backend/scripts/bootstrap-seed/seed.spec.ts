import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEV_ADMIN_PASSWORD,
  DEV_ANON_KEY,
  DEV_ENCRYPTION_KEY,
  DEV_REDIS_URL,
  generateKey,
  planAdmin,
  planSecrets,
  readEnv,
  runStep,
  seedAdmin,
  seedVault,
  type SecretPlan,
  type SeedEnv,
} from './seed';

const env = (vars: Record<string, string> = {}): SeedEnv =>
  readEnv(vars as unknown as NodeJS.ProcessEnv);
/** No opt-in: the strict policy, which every real node gets. */
const prod = (vars: Record<string, string> = {}) =>
  env({ NODE_ENV: 'production', ...vars });
const DEV = { SEED_DEV_DEFAULTS: 'true' };
const NONE = new Set<string>();
const ALL = new Set([
  'SENSITIVE_PROFILE_ENCRYPTION_KEY',
  'SUPABASE_ANON_KEY',
  'REDIS_URL',
]);
const byName = (plans: SecretPlan[], name: string) =>
  plans.find((p) => p.name === name)!;
const fixedKey = () => 'generated-key';

describe('planAdmin', () => {
  it('never touches an existing admin', () => {
    expect(planAdmin(prod({ SEED_ADMIN_PASSWORD: 'x' }), 'id-1')).toEqual({
      action: 'keep',
      id: 'id-1',
    });
    expect(planAdmin(env(DEV), 'id-1')).toEqual({ action: 'keep', id: 'id-1' });
  });

  it('a development node without the opt-in is strict', () => {
    expect(planAdmin(env({ NODE_ENV: 'development' }))).toMatchObject({
      action: 'skip',
    });
    expect(
      planSecrets(env({ NODE_ENV: 'development' }), ALL, fixedKey).map(
        (p) => p.action,
      ),
    ).toEqual(['keep', 'keep', 'keep']);
  });

  it('only the exact opt-in enables dev defaults', () => {
    expect(planAdmin(env({ SEED_DEV_DEFAULTS: '1' }))).toMatchObject({
      action: 'skip',
    });
  });

  it('with the dev opt-in, creates with the dev default', () => {
    expect(planAdmin(env(DEV))).toEqual({
      action: 'create',
      password: DEV_ADMIN_PASSWORD,
    });
  });

  it('in production, creates nothing without a supplied password', () => {
    expect(planAdmin(prod())).toMatchObject({ action: 'skip' });
    expect(planAdmin(prod({ SEED_ADMIN_PASSWORD: '' }))).toMatchObject({
      action: 'skip',
    });
  });

  it('in production, refuses the published default', () => {
    expect(
      planAdmin(prod({ SEED_ADMIN_PASSWORD: DEV_ADMIN_PASSWORD })),
    ).toMatchObject({
      action: 'skip',
      reason: expect.stringMatching(/default/),
    });
  });

  it('in production, creates with a supplied password', () => {
    expect(planAdmin(prod({ SEED_ADMIN_PASSWORD: 'long-random' }))).toEqual({
      action: 'create',
      password: 'long-random',
    });
  });
});

describe('planSecrets in production', () => {
  it('overwrites nothing that is already in Vault', () => {
    const plans = planSecrets(
      prod({
        SEED_SENSITIVE_PROFILE_ENCRYPTION_KEY: 'operator-key',
        SEED_SUPABASE_ANON_KEY: 'operator-anon',
        SEED_REDIS_URL: 'redis://managed',
      }),
      ALL,
      fixedKey,
    );
    expect(plans.map((p) => p.action)).toEqual(['keep', 'keep', 'keep']);
  });

  it('generates the encryption key on a fresh node, never the dev default', () => {
    const key = byName(
      planSecrets(prod(), NONE, fixedKey),
      'SENSITIVE_PROFILE_ENCRYPTION_KEY',
    );
    expect(key).toMatchObject({ action: 'write', value: 'generated-key' });
  });

  it('treats a supplied dev default key as nothing supplied', () => {
    const key = byName(
      planSecrets(
        prod({ SEED_SENSITIVE_PROFILE_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY }),
        NONE,
        fixedKey,
      ),
      'SENSITIVE_PROFILE_ENCRYPTION_KEY',
    );
    expect(key).toMatchObject({ action: 'write', value: 'generated-key' });
  });

  it('uses a supplied encryption key', () => {
    const key = byName(
      planSecrets(
        prod({ SEED_SENSITIVE_PROFILE_ENCRYPTION_KEY: 'operator-key' }),
        NONE,
        fixedKey,
      ),
      'SENSITIVE_PROFILE_ENCRYPTION_KEY',
    );
    expect(key).toMatchObject({ action: 'write', value: 'operator-key' });
  });

  it('leaves a secret the env already holds out of Vault, rather than override it', () => {
    const plans = planSecrets(
      prod({
        SENSITIVE_PROFILE_ENCRYPTION_KEY: 'key-the-node-runs-on',
        REDIS_URL: 'redis://managed:6380',
      }),
      NONE,
      fixedKey,
    );
    expect(byName(plans, 'SENSITIVE_PROFILE_ENCRYPTION_KEY')).toMatchObject({
      action: 'skip',
    });
    expect(byName(plans, 'REDIS_URL')).toMatchObject({ action: 'skip' });
  });

  it('flags a generated key so it is logged loudly', () => {
    expect(
      byName(
        planSecrets(prod(), NONE, fixedKey),
        'SENSITIVE_PROFILE_ENCRYPTION_KEY',
      ),
    ).toMatchObject({ action: 'write', generated: true });
  });

  it('never writes the demo anon JWT', () => {
    const cases: Record<string, string>[] = [
      {},
      { SEED_SUPABASE_ANON_KEY: DEV_ANON_KEY },
    ];
    for (const vars of cases) {
      expect(
        byName(planSecrets(prod(vars), NONE, fixedKey), 'SUPABASE_ANON_KEY'),
      ).toMatchObject({ action: 'skip' });
    }
  });

  it('writes the compose redis URL, which is not a secret', () => {
    expect(
      byName(planSecrets(prod(), NONE, fixedKey), 'REDIS_URL'),
    ).toMatchObject({ action: 'write', value: DEV_REDIS_URL });
  });
});

describe('planSecrets with dev defaults', () => {
  it('upserts every secret with its default, present or not', () => {
    const plans = planSecrets(env(DEV), ALL, fixedKey);
    expect(
      plans.map((p) => [p.name, p.action, (p as { value: string }).value]),
    ).toEqual([
      ['SENSITIVE_PROFILE_ENCRYPTION_KEY', 'write', DEV_ENCRYPTION_KEY],
      ['SUPABASE_ANON_KEY', 'write', DEV_ANON_KEY],
      ['REDIS_URL', 'write', DEV_REDIS_URL],
    ]);
  });
});

describe('generateKey', () => {
  it('is 32 random bytes, base64', () => {
    const a = generateKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(generateKey());
  });
});

/** A fake of GoTrue, PostgREST and pg-meta, recording every call. */
function fakeSupabase(state: {
  admins?: { id: string; email: string }[];
  secrets?: string[];
}) {
  const calls: {
    method: string;
    url: string;
    body?: Record<string, unknown>;
  }[] = [];
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetchMock = jest.fn((url: string, init: RequestInit) => {
    const body = init.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ method: String(init.method), url, body });
    if (url.includes('/auth/v1/admin/users') && init.method === 'GET') {
      return reply(200, { users: state.admins ?? [] });
    }
    if (url.endsWith('/auth/v1/admin/users'))
      return reply(200, { id: 'new-admin' });
    if (url.endsWith('/rpc/vault_list_secrets')) {
      return reply(
        200,
        (state.secrets ?? []).map((name) => ({ name })),
      );
    }
    return reply(200, {});
  });
  return { calls, fetchMock };
}

describe('seedAdmin / seedVault against a fake Supabase', () => {
  let dir: string;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seed-'));
    writeFileSync(join(dir, 'vault.sql'), 'SELECT 1;');
    logs.length = 0;
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const useFetch = (mock: jest.Mock) =>
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(mock as unknown as typeof fetch);

  const seedEnv = (vars: Record<string, string>) =>
    env({
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      VAULT_FUNCTIONS_FILE: join(dir, 'vault.sql'),
      ...vars,
    });

  async function runVault(e: SeedEnv) {
    const done = seedVault(e);
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
  }

  it('production redeploy writes no secret and creates no admin', async () => {
    const { calls, fetchMock } = fakeSupabase({
      admins: [{ id: 'kept', email: 'admin@opuspopuli.local' }],
      secrets: [
        'SENSITIVE_PROFILE_ENCRYPTION_KEY',
        'SUPABASE_ANON_KEY',
        'REDIS_URL',
      ],
    });
    useFetch(fetchMock);
    const e = seedEnv({ NODE_ENV: 'production' });
    const id = await seedAdmin(e);
    await runVault(e);
    const writes = calls.filter(
      (c) =>
        c.url.endsWith('/rpc/vault_create_secret') ||
        (c.method === 'POST' && c.url.endsWith('/admin/users')),
    );
    expect(writes).toEqual([]);
    expect(id).toBe('kept');
  });

  it('production with a failed listing writes nothing', async () => {
    const { calls, fetchMock } = fakeSupabase({});
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url });
      const status = url.endsWith('/rpc/vault_list_secrets') ? 503 : 200;
      return Promise.resolve(new Response('{}', { status }));
    });
    useFetch(fetchMock);
    const refused = expect(
      seedVault(seedEnv({ NODE_ENV: 'production' })),
    ).rejects.toThrow(/503/);
    await jest.advanceTimersByTimeAsync(1_000);
    await refused;
    expect(calls.some((c) => c.url.endsWith('/rpc/vault_create_secret'))).toBe(
      false,
    );
  });

  it('production fresh node: no admin without a password, a generated key', async () => {
    const { calls, fetchMock } = fakeSupabase({});
    useFetch(fetchMock);
    const e = seedEnv({ NODE_ENV: 'production' });
    expect(await seedAdmin(e)).toBeUndefined();
    await runVault(e);
    const written = calls
      .filter((c) => c.url.endsWith('/rpc/vault_create_secret'))
      .map((c) => [c.body!.p_name, c.body!.p_value]);
    expect(written).toHaveLength(2);
    const key = written.find(
      ([n]) => n === 'SENSITIVE_PROFILE_ENCRYPTION_KEY',
    )!;
    expect(key[1]).not.toBe(DEV_ENCRYPTION_KEY);
    expect(Buffer.from(String(key[1]), 'base64')).toHaveLength(32);
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/admin/users')),
    ).toBe(false);
  });

  it('never logs a secret value, in either policy', async () => {
    const { calls, fetchMock } = fakeSupabase({});
    useFetch(fetchMock);
    const strict = {
      NODE_ENV: 'production',
      SEED_ADMIN_PASSWORD: 'supplied-pw',
    };
    for (const vars of [DEV, strict]) {
      await seedAdmin(seedEnv(vars));
      await runVault(seedEnv(vars));
    }
    const written = calls
      .map((c) => c.body?.p_value ?? c.body?.password)
      .filter((v): v is string => typeof v === 'string');
    // The generated key and the supplied password were really sent.
    expect(written).toContain('supplied-pw');
    expect(written.length).toBeGreaterThanOrEqual(6);
    const out = logs.join('\n');
    for (const secret of [...written, 'service']) {
      expect(out).not.toContain(secret);
    }
  });

  it('runStep writes the admin id to stdout and nothing else', async () => {
    const { fetchMock } = fakeSupabase({});
    useFetch(fetchMock);
    const stdout: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    await runStep('admin', seedEnv(DEV));
    expect(stdout).toEqual(['new-admin\n']);
    stdout.length = 0;
    await runStep('admin', seedEnv({}));
    expect(stdout).toEqual([]);
  });
});

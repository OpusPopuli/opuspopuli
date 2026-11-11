/**
 * Bootstrap seed run by `db-migrate.sh` on every `docker compose up`.
 *
 *   ts-node --transpile-only seed.ts admin   # first admin account
 *   ts-node --transpile-only seed.ts vault   # bootstrap Vault secrets
 *
 * Stacks that opt in with `SEED_DEV_DEFAULTS=true` (the UAT, integration and
 * e2e compose files) get working defaults, as they always have. Everything
 * else, including any node whatever its `NODE_ENV`, gets the strict policy.
 * `NODE_ENV` can't decide this: a `--local-only` node runs as `development`
 * for CORS and is still a real deployment.
 *
 * - The first admin is created only from an operator-supplied
 *   `SEED_ADMIN_PASSWORD`. The published default is refused. An existing
 *   admin is never touched.
 * - A Vault secret is written only when absent. Every deploy used to upsert
 *   the dev defaults, so a rotated `SENSITIVE_PROFILE_ENCRYPTION_KEY` was
 *   reverted to the key printed in this repo on the next `up -d`, and rows
 *   encrypted under the rotated key became unreadable.
 *
 * Every step is non-fatal, as before: GoTrue and PostgREST may still be
 * starting, and a failed seed must not stop the migration that precedes it.
 * Nothing here logs a secret value or a response body that could echo one.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Published in this repo. Acceptable only where nothing real is stored. */
export const DEV_ADMIN_PASSWORD = 'Admin1234!';
// Deliberately public since #742, and refused outside dev stacks (#1441).
export const DEV_ENCRYPTION_KEY =
  'jv4vjdDIE+PqHm0WunsG3K4gA882jyQnkFaU5AYtAnM='; // gitleaks:allow
/** The well-known self-hosted Supabase demo JWT (anon role). */
export const DEV_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.KR1jqUlyHtwAxCJf6B0QVoRpobrdPEv8ALnNJUlGxPE';
export const DEV_REDIS_URL = 'redis://redis:6379';

export interface SeedEnv {
  /** Only with `SEED_DEV_DEFAULTS=true`. Otherwise the strict policy. */
  devDefaults: boolean;
  supabaseUrl: string;
  pgMetaUrl: string;
  serviceKey?: string;
  admin: { email: string; username: string; password?: string };
  secrets: { encryptionKey?: string; anonKey?: string; redisUrl?: string };
  vaultFunctionsFile: string;
}

const nonEmpty = (v: string | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : v;

export function readEnv(env: NodeJS.ProcessEnv): SeedEnv {
  return {
    devDefaults: env.SEED_DEV_DEFAULTS === 'true',
    supabaseUrl: env.SUPABASE_URL || 'http://supabase-kong:8000',
    pgMetaUrl: env.PG_META_URL || 'http://supabase-meta:8080',
    serviceKey: nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY),
    admin: {
      email: env.SEED_ADMIN_EMAIL || 'admin@opuspopuli.local',
      username: env.SEED_ADMIN_USERNAME || 'admin',
      password: nonEmpty(env.SEED_ADMIN_PASSWORD),
    },
    secrets: {
      encryptionKey: nonEmpty(env.SEED_SENSITIVE_PROFILE_ENCRYPTION_KEY),
      anonKey: nonEmpty(env.SEED_SUPABASE_ANON_KEY),
      redisUrl: nonEmpty(env.SEED_REDIS_URL),
    },
    vaultFunctionsFile:
      env.VAULT_FUNCTIONS_FILE ||
      '/usr/src/app/supabase/migrations/99_vault_functions.sql',
  };
}

// ── Admin ────────────────────────────────────────────────────────────────

export type AdminPlan =
  | { action: 'keep'; id: string }
  | { action: 'create'; password: string }
  | { action: 'skip'; reason: string };

export function planAdmin(env: SeedEnv, existingId?: string): AdminPlan {
  if (existingId) return { action: 'keep', id: existingId };
  const supplied = env.admin.password;
  if (env.devDefaults) {
    return { action: 'create', password: supplied ?? DEV_ADMIN_PASSWORD };
  }
  if (supplied === undefined) {
    return {
      action: 'skip',
      reason:
        'no default is used outside dev stacks; pass SEED_ADMIN_PASSWORD to db-migrate, or create the admin by hand',
    };
  }
  if (supplied === DEV_ADMIN_PASSWORD) {
    return {
      action: 'skip',
      reason: 'SEED_ADMIN_PASSWORD is the published dev default',
    };
  }
  return { action: 'create', password: supplied };
}

// ── Vault ────────────────────────────────────────────────────────────────

export type SecretPlan =
  | { name: string; action: 'write'; value: string; description: string }
  | { name: string; action: 'keep' | 'skip'; reason: string };

interface SecretSpec {
  name: string;
  description: string;
  supplied: string | undefined;
  devDefault: string;
  /**
   * What a strict stack with nothing supplied gets: a generated value, the
   * default (when it isn't a secret), or nothing.
   */
  strictFallback: 'generate' | 'default' | 'none';
}

function secretSpecs(env: SeedEnv): SecretSpec[] {
  return [
    {
      name: 'SENSITIVE_PROFILE_ENCRYPTION_KEY',
      description:
        'AES-256-GCM key for users.SensitiveProfile T3 column encryption (#742).',
      supplied: env.secrets.encryptionKey,
      devDefault: DEV_ENCRYPTION_KEY,
      strictFallback: 'generate',
    },
    {
      name: 'SUPABASE_ANON_KEY',
      description:
        'Supabase anon-role JWT. Dev default is the self-hosted demo JWT; set SEED_SUPABASE_ANON_KEY otherwise (#792).',
      supplied: env.secrets.anonKey,
      devDefault: DEV_ANON_KEY,
      strictFallback: 'none',
    },
    {
      name: 'REDIS_URL',
      description:
        'BullMQ + cache Redis connection string. Defaults to the compose redis service; set SEED_REDIS_URL otherwise (#792).',
      supplied: env.secrets.redisUrl,
      devDefault: DEV_REDIS_URL,
      strictFallback: 'default',
    },
  ];
}

/** A random 256-bit key, base64, as the T3 encryption expects. */
export const generateKey = (): string => randomBytes(32).toString('base64');

/**
 * A supplied value a strict stack may write. The published default counts as
 * nothing supplied, except where the default isn't a secret at all.
 */
function usableSupplied(spec: SecretSpec): string | undefined {
  if (spec.supplied === undefined) return undefined;
  if (spec.strictFallback === 'default') return spec.supplied;
  return spec.supplied === spec.devDefault ? undefined : spec.supplied;
}

function planStrictSecret(
  spec: SecretSpec,
  present: boolean,
  generate: () => string,
): SecretPlan {
  const { name, description } = spec;
  if (present) {
    return { name, action: 'keep', reason: 'present; never overwritten' };
  }
  const usable = usableSupplied(spec);
  if (usable !== undefined) {
    return { name, action: 'write', value: usable, description };
  }
  switch (spec.strictFallback) {
    case 'generate':
      return { name, action: 'write', value: generate(), description };
    case 'default':
      return { name, action: 'write', value: spec.devDefault, description };
    case 'none':
      return {
        name,
        action: 'skip',
        reason: `absent; needs a supplied value (SEED_${name})`,
      };
  }
}

/**
 * What to do with each bootstrap secret, given the names already in Vault.
 * With dev defaults every secret is upserted with its default, as before:
 * that rewrite is also what recovers a dev row whose ciphertext was left
 * under a lost pgsodium key (#789, #791).
 */
export function planSecrets(
  env: SeedEnv,
  present: ReadonlySet<string>,
  generate: () => string = generateKey,
): SecretPlan[] {
  return secretSpecs(env).map((spec) =>
    env.devDefaults
      ? {
          name: spec.name,
          action: 'write',
          value: spec.supplied ?? spec.devDefault,
          description: spec.description,
        }
      : planStrictSecret(spec, present.has(spec.name), generate),
  );
}

// ── Output ───────────────────────────────────────────────────────────────

/**
 * Progress goes to stderr. Stdout carries one thing, the admin's id from
 * `seed.ts admin`, which db-migrate.sh captures for `public.users`.
 */
const say = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

// ── HTTP ─────────────────────────────────────────────────────────────────

interface Reply {
  status: number;
  body: string;
}

async function send(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Parse a reply without letting a parse error quote it: V8 puts a slice of
 * the input in the message, and these bodies hold user records.
 */
function parseJson<T>(reply: Reply, what: string): T {
  try {
    return JSON.parse(reply.body) as T;
  } catch {
    throw new Error(`${what} returned a body that is not JSON`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const serviceAuth = (key: string): Record<string, string> => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
});

// ── Runners ──────────────────────────────────────────────────────────────

async function findAdminId(
  env: SeedEnv,
  key: string,
): Promise<string | undefined> {
  const url = `${env.supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(env.admin.email)}`;
  const res = await send('GET', url, serviceAuth(key));
  if (res.status >= 400)
    throw new Error(`GoTrue lookup returned ${res.status}`);
  const list = parseJson<{ users?: { id: string; email: string }[] }>(
    res,
    'GoTrue lookup',
  );
  return list.users?.find((u) => u.email === env.admin.email)?.id;
}

async function createAdmin(
  env: SeedEnv,
  key: string,
  password: string,
): Promise<string | undefined> {
  const res = await send(
    'POST',
    `${env.supabaseUrl}/auth/v1/admin/users`,
    serviceAuth(key),
    {
      email: env.admin.email,
      password,
      email_confirm: true,
      app_metadata: { roles: ['admin'] },
      user_metadata: { username: env.admin.username },
    },
  );
  if (res.status === 422) {
    // Registered but not on the first page of the lookup. It exists, which
    // is all this step needs; it is never modified.
    say('Admin user already exists (GoTrue 422), skipping.');
    return undefined;
  }
  if (res.status >= 400)
    throw new Error(`GoTrue create returned ${res.status}`);
  return parseJson<{ id: string }>(res, 'GoTrue create').id;
}

/** The admin's id when one exists or was created, for `public.users`. */
export async function seedAdmin(env: SeedEnv): Promise<string | undefined> {
  if (!env.serviceKey) {
    say('Admin seed skipped: SUPABASE_SERVICE_ROLE_KEY not set.');
    return undefined;
  }
  const plan = planAdmin(env, await findAdminId(env, env.serviceKey));
  if (plan.action === 'keep') {
    say('Admin user already exists, skipping.');
    return plan.id;
  }
  if (plan.action === 'skip') {
    say(`Admin user not created: ${plan.reason}.`);
    return undefined;
  }
  const id = await createAdmin(env, env.serviceKey, plan.password);
  if (id) say(`Admin user created (id=${id}).`);
  return id;
}

/**
 * Names (never values) of the secrets already in Vault. A 404 is retried:
 * on a brand-new database PostgREST may not have loaded the function yet.
 */
async function presentSecretNames(
  env: SeedEnv,
  key: string,
  attempts = 3,
): Promise<Set<string>> {
  const url = `${env.supabaseUrl}/rest/v1/rpc/vault_list_secrets`;
  let res = await send('POST', url, serviceAuth(key), {});
  for (let i = 1; i < attempts && res.status === 404; i++) {
    await sleep(2_000);
    res = await send('POST', url, serviceAuth(key), {});
  }
  if (res.status >= 400)
    throw new Error(`vault_list_secrets returned ${res.status}`);
  const rows = parseJson<{ name: string }[]>(res, 'vault_list_secrets');
  return new Set(rows.map((s) => s.name));
}

async function installVaultFunctions(env: SeedEnv): Promise<void> {
  const sql = readFileSync(env.vaultFunctionsFile, 'utf8');
  const install = await send(
    'POST',
    `${env.pgMetaUrl}/query`,
    {},
    { query: sql },
  );
  if (install.status >= 400)
    throw new Error(`pg-meta /query returned ${install.status}`);
  say('Vault RPC functions installed');
  const reload = await send(
    'POST',
    `${env.pgMetaUrl}/query`,
    {},
    { query: "NOTIFY pgrst, 'reload schema';" },
  );
  if (reload.status >= 400)
    say(`PostgREST schema reload returned ${reload.status}`);
  // Give PostgREST a moment to pick up the functions before calling them.
  await sleep(1_000);
}

async function writeSecret(
  env: SeedEnv,
  key: string,
  plan: SecretPlan,
): Promise<void> {
  if (plan.action !== 'write') {
    say(`${plan.name}: ${plan.action} (${plan.reason})`);
    return;
  }
  const res = await send(
    'POST',
    `${env.supabaseUrl}/rest/v1/rpc/vault_create_secret`,
    serviceAuth(key),
    {
      p_name: plan.name,
      p_value: plan.value,
      p_description: plan.description,
    },
  );
  if (res.status >= 400) {
    say(`${plan.name}: write failed (non-fatal), status ${res.status}`);
  } else {
    say(`${plan.name}: written`);
  }
}

export async function seedVault(env: SeedEnv): Promise<void> {
  if (!env.serviceKey) {
    say('Vault seed skipped: SUPABASE_SERVICE_ROLE_KEY not set.');
    return;
  }
  await installVaultFunctions(env);
  // A strict stack must know what is there before writing anything. If the
  // listing fails, nothing is written.
  const present = env.devDefaults
    ? new Set<string>()
    : await presentSecretNames(env, env.serviceKey);
  const key = env.serviceKey;
  await Promise.all(
    planSecrets(env, present).map((plan) =>
      writeSecret(env, key, plan).catch((error: Error) => {
        say(`${plan.name}: write threw (non-fatal): ${error.message}`);
      }),
    ),
  );
}

/** One step, as db-migrate.sh runs it. Stdout gets the admin id or nothing. */
export async function runStep(
  step: string | undefined,
  env: SeedEnv,
): Promise<void> {
  try {
    if (step === 'admin') {
      const id = await seedAdmin(env);
      if (id) process.stdout.write(`${id}\n`);
    } else if (step === 'vault') {
      await seedVault(env);
    } else {
      say('usage: seed.ts admin|vault');
      process.exitCode = 1;
    }
  } catch (error) {
    say(`${step} seed skipped (non-fatal): ${(error as Error).message}`);
  }
}

if (require.main === module)
  void runStep(process.argv[2], readEnv(process.env));

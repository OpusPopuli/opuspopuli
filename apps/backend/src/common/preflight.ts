import { Logger, Type } from '@nestjs/common';
import { hydrateEnvFromVault } from '@opuspopuli/secrets-provider';
import bootstrap from './bootstrap';

const logger = new Logger('Preflight');

/**
 * Secrets sourced from Supabase Vault at bootstrap when
 * `SECRETS_PROVIDER=supabase`. Hydration must run before any
 * application module is loaded — `@nestjs/config`'s `forRoot()`
 * runs Joi validation at the @Module-decorator evaluation step
 * (synchronously, at file-import time), so any vault-managed
 * secret in the validation schema must already be in `process.env`
 * before the import statement executes.
 *
 * `preflightAndLoad()` enforces this ordering by running hydration
 * first, then performing the AppModule import dynamically.
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are intentionally
 * NOT in this list — they're required to reach Vault in the first
 * place and stay as env vars by necessity.
 *
 * Internal cryptographic secrets (`JWT_SECRET`, `AUTH_JWT_SECRET`,
 * `GATEWAY_HMAC_SECRET`, `API_KEYS`) are NOT in this list either —
 * they need fail-fast behavior on missing-secret rather than the
 * current tolerant warn-and-continue. Migration of those secrets
 * requires extending the hydration mechanism with a strict mode.
 *
 * See issues #786 (mechanism), #792 (extended list + prod flip).
 */
export const VAULT_BACKED_SECRETS = [
  'RESEND_API_KEY',
  'SMTP_USER',
  'SMTP_PASS',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'REDIS_URL',
  'SUPABASE_ANON_KEY',
  'FEC_API_KEY',
] as const;

/**
 * Hydrates Vault-backed secrets into `process.env`, then invokes
 * the provided loader to dynamically import the application or
 * worker module. The dynamic import ensures the @Module decorator
 * (and any synchronous validation it triggers) sees the hydrated
 * environment.
 *
 * Usage from each service / worker `main.ts`:
 *
 * ```ts
 * preflightAndLoad(() => import('./app.module')).then(({ AppModule }) =>
 *   bootstrap(AppModule, { portEnvVar: 'USERS_PORT' }),
 * );
 * ```
 */
export async function preflightAndLoad<T>(
  loader: () => Promise<T>,
): Promise<T> {
  await hydrateEnvFromVault(VAULT_BACKED_SECRETS);
  return loader();
}

interface RunServiceOptions {
  portEnvVar?: string;
}

/**
 * Convenience wrapper for HTTP service `main.ts` entry points. Combines
 * preflight + dynamic import + shared bootstrap into a single call.
 *
 * Catches and logs any startup failure (preflight error, module import
 * error, NestJS bootstrap error) and exits the process so the failure
 * mode is loud rather than a silent `unhandledRejection`.
 *
 * Usage:
 *
 * ```ts
 * import 'src/common/tracing';
 * import { runService } from 'src/common/preflight';
 *
 * runService(() => import('./app.module'), { portEnvVar: 'USERS_PORT' });
 * ```
 *
 * Workers have a more heterogeneous startup (custom port vars, custom
 * undici pool config, distinct loggers) and use `preflightAndLoad`
 * directly inside their own `bootstrap()` async function instead.
 */
export function runService(
  loadAppModule: () => Promise<{ AppModule: Type<unknown> }>,
  options: RunServiceOptions = {},
): void {
  preflightAndLoad(loadAppModule)
    .then(({ AppModule }) => bootstrap(AppModule, options))
    .catch((err: unknown) => {
      logger.error(
        `Service startup failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      process.exit(1);
    });
}

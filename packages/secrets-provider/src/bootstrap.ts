import { Logger } from "@nestjs/common";
import { getSecrets } from "./providers/supabase-vault.provider.js";

const logger = new Logger("VaultHydration");

/**
 * Hydrates `process.env` with secrets from Supabase Vault before the
 * NestJS application is constructed. Must be invoked from the service
 * bootstrap *before* `NestFactory.create()` — `@nestjs/config`'s
 * `registerAs` factories read `process.env` at module-init time, so
 * values written after `NestFactory.create()` are not picked up by
 * `ConfigService`.
 *
 * Behavior:
 * - No-op unless `SECRETS_PROVIDER=supabase`.
 * - When active, each requested secret is fetched from Vault and written
 *   into `process.env`, **overwriting any existing value**. Vault is
 *   authoritative when the mode is active; runtime env values for
 *   vault-managed secrets are a policy violation per CLAUDE.md and
 *   should be loud rather than silently honored.
 * - Missing secrets log a warning and leave the existing env value
 *   (which may be empty) in place — they do not throw. This lets a
 *   partially-populated vault not block service startup during the
 *   incremental migration.
 *
 * Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to be present
 * as real env vars (chicken-and-egg: needed to reach Vault itself).
 */
export async function hydrateEnvFromVault(
  secretNames: readonly string[],
): Promise<void> {
  const mode = (process.env.SECRETS_PROVIDER || "env").toLowerCase();
  if (mode !== "supabase") {
    return;
  }

  if (secretNames.length === 0) {
    return;
  }

  // Parallel reads with per-secret failure isolation — Promise.all
  // settles when every promise resolves (either with a result or with
  // a try/catch-handled failure). Sequential `for...await` would add
  // ~one Vault round-trip's worth of latency per secret at startup.
  type Outcome =
    | { name: string; status: "hydrated"; overwrote: boolean }
    | { name: string; status: "missing" };

  const outcomes: Outcome[] = await Promise.all(
    secretNames.map(async (name): Promise<Outcome> => {
      try {
        const value = await getSecrets(name);
        const had = process.env[name];
        process.env[name] = value;
        return {
          name,
          status: "hydrated",
          overwrote: had !== undefined && had !== "" && had !== value,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Secret '${name}' not hydrated from Vault: ${message}. ` +
            `Existing env value (if any) left in place.`,
        );
        return { name, status: "missing" };
      }
    }),
  );

  type Hydrated = Extract<Outcome, { status: "hydrated" }>;
  const isHydrated = (o: Outcome): o is Hydrated => o.status === "hydrated";

  const hydrated = outcomes.filter(isHydrated).map((o) => o.name);
  const overwritten = outcomes
    .filter(isHydrated)
    .filter((o) => o.overwrote)
    .map((o) => o.name);
  const missing = outcomes
    .filter((o) => o.status === "missing")
    .map((o) => o.name);

  if (hydrated.length > 0) {
    logger.log(
      `Hydrated ${hydrated.length} secret(s) from Vault: ${hydrated.join(", ")}`,
    );
  }
  if (overwritten.length > 0) {
    logger.warn(
      `Vault values overwrote existing env vars: ${overwritten.join(", ")}. ` +
        `Env values for vault-managed secrets are ignored in supabase mode.`,
    );
  }
  if (missing.length > 0) {
    logger.warn(
      `${missing.length} secret(s) requested but not found in Vault: ${missing.join(", ")}`,
    );
  }
}

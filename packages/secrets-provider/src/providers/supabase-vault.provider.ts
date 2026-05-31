import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  ISecretsProvider,
  SecretsError,
  initSupabaseFromConfig,
} from "@opuspopuli/common";

/**
 * Default deadline for a single Vault round-trip. Prevents service
 * startup from hanging indefinitely on a Vault network partition or
 * Postgres deadlock — failing fast and falling back to env (per the
 * caller's handling) is preferable to a stuck boot.
 */
export const DEFAULT_VAULT_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Look up a vault secret given a pre-built Supabase client. Tries the
 * decrypted-secrets schema view first; falls back to the
 * `vault_read_secret` RPC when PostgREST hasn't exposed the vault
 * schema (the default in self-hosted Supabase setups, including local
 * UAT). The RPC is SECURITY DEFINER and runs with vault access
 * regardless of PostgREST's exposed-schemas list. See
 * supabase/migrations/99_vault_functions.sql.
 *
 * Returns `undefined` when the secret is not present in Vault.
 * Throws on PostgREST/RPC errors other than schema-not-exposed, or
 * when the timeout elapses.
 *
 * Shared by `getSecrets` (standalone bootstrap helper) and
 * `SupabaseVaultProvider.getSecret` (DI-injected class) so the
 * two-step fallback lives in exactly one place.
 */
export async function lookupSecret(
  supabase: SupabaseClient,
  secretName: string,
  timeoutMs: number = DEFAULT_VAULT_LOOKUP_TIMEOUT_MS,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Vault lookup for '${secretName}' timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );
  });

  const work = (async () => {
    const view = await tryViaSchemaView(supabase, secretName);
    if (view.handled) return view.value;
    return tryViaRpc(supabase, secretName);
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tryViaSchemaView(
  supabase: SupabaseClient,
  secretName: string,
): Promise<{ handled: boolean; value?: string }> {
  const { data, error } = await supabase
    .schema("vault")
    .from("decrypted_secrets")
    .select("decrypted_secret")
    .eq("name", secretName)
    .limit(1);

  if (error) {
    // PostgREST hasn't exposed `vault` — signal "try RPC".
    if (
      error.message.includes("schema must be one of") ||
      error.message.includes("does not exist") ||
      error.code === "PGRST106"
    ) {
      return { handled: false };
    }
    throw new Error(
      `Failed to retrieve secret ${secretName}: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    return { handled: true, value: undefined };
  }
  return {
    handled: true,
    value: (data[0] as { decrypted_secret: string })?.decrypted_secret || "",
  };
}

async function tryViaRpc(
  supabase: SupabaseClient,
  secretName: string,
): Promise<string | undefined> {
  const { data, error } = await supabase.rpc("vault_read_secret", {
    secret_name: secretName,
  });

  if (error) {
    // Platform misconfiguration: the RPC function itself isn't installed
    // (PGRST202 / "does not exist"). Surface as not-found so the service
    // can still boot and degrade to env, rather than crashing. Operator
    // should apply supabase/migrations/99_vault_functions.sql.
    if (error.message.includes("does not exist") || error.code === "PGRST202") {
      return undefined;
    }
    throw new Error(
      `Failed to retrieve secret ${secretName} via RPC: ${error.message}`,
    );
  }

  const rows = data as Array<{ decrypted_secret: string }> | null;
  if (!rows || rows.length === 0) return undefined;
  return rows[0].decrypted_secret || "";
}

/**
 * Standalone bootstrap helper — builds its own Supabase client and
 * delegates to `lookupSecret`. Throws when the secret is missing
 * (preserving the long-standing API of this function).
 *
 * Requires environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 */
export async function getSecrets(
  secretName: string,
  supabaseUrl?: string,
  supabaseKey?: string,
): Promise<string> {
  const url = supabaseUrl || process.env.SUPABASE_URL;
  const key =
    supabaseKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase URL and key are required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.",
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const value = await lookupSecret(supabase, secretName);
  if (value === undefined) {
    throw new Error(`Secret not found: ${secretName}`);
  }
  return value;
}

/**
 * Supabase Vault Provider
 *
 * Implements secrets retrieval using Supabase Vault (pgsodium).
 * Queries the `vault.decrypted_secrets` view directly via PostgREST.
 *
 * Prerequisites:
 * - Supabase project with Vault enabled (pgsodium extension)
 * - Secrets created via Supabase Studio or `vault.create_secret()`
 * - PostgREST must expose the `vault` schema (default in self-hosted setups)
 */
@Injectable()
export class SupabaseVaultProvider implements ISecretsProvider {
  private readonly logger = new Logger(SupabaseVaultProvider.name, {
    timestamp: true,
  });
  private readonly supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    try {
      const { supabase, url } = initSupabaseFromConfig(
        (key) => configService.get<string>(key),
        createClient,
      );
      this.supabase = supabase;
      this.logger.log(`SupabaseVaultProvider initialized for: ${url}`);
    } catch {
      throw new SecretsError(
        "Supabase URL and key are required",
        "CONFIG_ERROR",
      );
    }
  }

  getName(): string {
    return "SupabaseVaultProvider";
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    try {
      const value = await lookupSecret(this.supabase, secretId);
      if (value === undefined) {
        this.logger.warn(`Secret not found: ${secretId}`);
      } else {
        this.logger.log(`Retrieved secret: ${secretId}`);
      }
      return value;
    } catch (error) {
      this.logger.error(`Error retrieving secret: ${(error as Error).message}`);
      throw new SecretsError(
        `Failed to retrieve secret ${secretId}`,
        "GET_SECRET_ERROR",
        error as Error,
      );
    }
  }

  async getSecrets(
    secretIds: string[],
  ): Promise<Record<string, string | undefined>> {
    const results: Record<string, string | undefined> = {};

    // Fetch secrets in parallel
    const promises = secretIds.map(async (secretId) => {
      try {
        results[secretId] = await this.getSecret(secretId);
      } catch (error) {
        this.logger.error(
          `Error retrieving secret ${secretId}: ${(error as Error).message}`,
        );
        results[secretId] = undefined;
      }
    });

    await Promise.all(promises);

    return results;
  }

  async getSecretJson<T>(secretId: string): Promise<T | undefined> {
    const secret = await this.getSecret(secretId);

    if (!secret) {
      return undefined;
    }

    try {
      return JSON.parse(secret) as T;
    } catch (error) {
      this.logger.error(
        `Error parsing secret JSON: ${(error as Error).message}`,
      );
      throw new SecretsError(
        `Failed to parse secret ${secretId} as JSON`,
        "PARSE_SECRET_ERROR",
        error as Error,
      );
    }
  }
}

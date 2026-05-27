import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  ISecretsProvider,
  SecretsError,
  initSupabaseFromConfig,
} from "@opuspopuli/common";

/**
 * Helper function to get a secret without dependency injection.
 * Useful for bootstrap/config scenarios before DI is available.
 *
 * Requires environment variables:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
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
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .schema("vault")
    .from("decrypted_secrets")
    .select("decrypted_secret")
    .eq("name", secretName)
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to retrieve secret ${secretName}: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    throw new Error(`Secret not found: ${secretName}`);
  }

  return (data[0] as { decrypted_secret: string })?.decrypted_secret || "";
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
    // Try the direct view query first — works when PostgREST is
    // configured with `vault` in db-schemas. Fall back to the
    // `vault_read_secret` RPC when it isn't (which is the default in
    // self-hosted Supabase setups, including local UAT). The RPC is
    // SECURITY DEFINER and runs with vault access regardless of
    // PostgREST's exposed-schemas list. See supabase/migrations/
    // 99_vault_functions.sql for the function definition.
    const fromView = await this.trySecretViaSchemaView(secretId);
    if (fromView.handled) return fromView.value;
    return this.trySecretViaRpc(secretId);
  }

  private async trySecretViaSchemaView(
    secretId: string,
  ): Promise<{ handled: boolean; value?: string }> {
    try {
      const { data, error } = await this.supabase
        .schema("vault")
        .from("decrypted_secrets")
        .select("decrypted_secret")
        .eq("name", secretId)
        .limit(1);

      if (error) {
        // PostgREST hasn't exposed `vault` — fall through to RPC.
        if (
          error.message.includes("schema must be one of") ||
          error.message.includes("does not exist") ||
          error.code === "PGRST106"
        ) {
          this.logger.debug(
            `vault.decrypted_secrets not exposed via PostgREST; trying vault_read_secret() RPC`,
          );
          return { handled: false };
        }
        // Real error — let the outer catch surface it.
        throw error;
      }

      if (!data || data.length === 0) {
        this.logger.warn(`Secret not found: ${secretId}`);
        return { handled: true, value: undefined };
      }

      this.logger.log(`Retrieved secret: ${secretId} (via vault schema view)`);
      return {
        handled: true,
        value: (data[0] as { decrypted_secret: string })?.decrypted_secret,
      };
    } catch (error) {
      throw new SecretsError(
        `Failed to retrieve secret ${secretId}`,
        "GET_SECRET_ERROR",
        error as Error,
      );
    }
  }

  private async trySecretViaRpc(secretId: string): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase.rpc("vault_read_secret", {
        secret_name: secretId,
      });

      if (error) {
        // 404-equivalent on a missing function is a clear platform
        // misconfiguration — surface as not-found rather than crash.
        if (
          error.message.includes("does not exist") ||
          error.code === "PGRST202"
        ) {
          this.logger.warn(
            `vault_read_secret RPC not available — local platform may need supabase/migrations/99_vault_functions.sql applied`,
          );
          return undefined;
        }
        throw error;
      }

      // RPC returns a setof — Supabase JS returns the array. An empty
      // array means the secret name was not found.
      const rows = data as Array<{ decrypted_secret: string }> | null;
      if (!rows || rows.length === 0) {
        this.logger.warn(`Secret not found: ${secretId}`);
        return undefined;
      }

      this.logger.log(
        `Retrieved secret: ${secretId} (via vault_read_secret RPC)`,
      );
      return rows[0].decrypted_secret;
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

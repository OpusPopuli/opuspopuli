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
    try {
      // Query the vault.decrypted_secrets view directly via PostgREST schema()
      // This avoids needing a custom vault_read_secret() database function.
      const { data, error } = await this.supabase
        .schema("vault")
        .from("decrypted_secrets")
        .select("decrypted_secret")
        .eq("name", secretId)
        .limit(1);

      if (error) {
        // Handle not found / permission errors
        if (
          error.message.includes("does not exist") ||
          error.code === "PGRST116"
        ) {
          this.logger.warn(`Secret not found: ${secretId}`);
          return undefined;
        }
        throw error;
      }

      if (!data || data.length === 0) {
        this.logger.warn(`Secret not found: ${secretId}`);
        return undefined;
      }

      this.logger.log(`Retrieved secret: ${secretId}`);
      return (data[0] as { decrypted_secret: string })?.decrypted_secret;
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

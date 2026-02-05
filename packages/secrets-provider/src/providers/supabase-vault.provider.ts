import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ISecretsProvider, SecretsError } from "@opuspopuli/common";

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

  const { data, error } = await supabase.rpc("vault_read_secret", {
    secret_name: secretName,
  });

  if (error) {
    throw new Error(
      `Failed to retrieve secret ${secretName}: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    throw new Error(`Secret not found: ${secretName}`);
  }

  return data[0]?.decrypted_secret || "";
}

/**
 * Supabase Vault Provider
 *
 * Implements secrets retrieval using Supabase Vault (pgsodium).
 * Provides an OSS alternative to AWS Secrets Manager.
 *
 * Prerequisites:
 * - Supabase project with Vault enabled
 * - Database function `vault_read_secret` to read from vault.decrypted_secrets
 *
 * SQL to create the function:
 * ```sql
 * CREATE OR REPLACE FUNCTION vault_read_secret(secret_name text)
 * RETURNS TABLE (decrypted_secret text)
 * LANGUAGE plpgsql SECURITY DEFINER AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT vault.decrypted_secrets.decrypted_secret
 *   FROM vault.decrypted_secrets
 *   WHERE vault.decrypted_secrets.name = secret_name;
 * END;
 * $$;
 * ```
 */
@Injectable()
export class SupabaseVaultProvider implements ISecretsProvider {
  private readonly logger = new Logger(SupabaseVaultProvider.name, {
    timestamp: true,
  });
  private readonly supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = configService.get<string>("supabase.url");
    const supabaseServiceKey = configService.get<string>(
      "supabase.serviceRoleKey",
    );
    const supabaseAnonKey = configService.get<string>("supabase.anonKey");

    if (!supabaseUrl || (!supabaseServiceKey && !supabaseAnonKey)) {
      throw new SecretsError(
        "Supabase URL and key are required",
        "CONFIG_ERROR",
      );
    }

    // Use service role key for admin operations, fall back to anon key
    const key = supabaseServiceKey || supabaseAnonKey;

    this.supabase = createClient(supabaseUrl, key!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log(`SupabaseVaultProvider initialized for: ${supabaseUrl}`);
  }

  getName(): string {
    return "SupabaseVaultProvider";
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    try {
      // Call the database function to read from vault.decrypted_secrets
      const { data, error } = await this.supabase.rpc("vault_read_secret", {
        secret_name: secretId,
      });

      if (error) {
        // Handle not found case
        if (
          error.message.includes("does not exist") ||
          error.code === "PGRST116"
        ) {
          this.logger.warn(`Secret not found: ${secretId}`);
          return undefined;
        }
        throw error;
      }

      // The RPC returns an array of rows
      if (!data || data.length === 0) {
        this.logger.warn(`Secret not found: ${secretId}`);
        return undefined;
      }

      this.logger.log(`Retrieved secret: ${secretId}`);
      return data[0]?.decrypted_secret;
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

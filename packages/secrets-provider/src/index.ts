/**
 * @opuspopuli/secrets-provider
 *
 * Secrets provider implementations for the Opus Populi platform.
 * Provides pluggable secrets management with multiple backends.
 *
 * Providers:
 * - EnvProvider (default): Read from process.env
 * - SupabaseVaultProvider: Supabase Vault
 */

// Re-export types from common
export {
  ISecretsProvider,
  ISecretsConfig,
  SecretsError,
} from "@opuspopuli/common";

// Module
export { SecretsModule, SECRETS_PROVIDER } from "./secrets.module.js";

// Providers
export {
  EnvProvider,
  getEnvSecret,
  getEnvSecretOrThrow,
} from "./providers/env.provider.js";

export {
  SupabaseVaultProvider,
  getSecrets,
} from "./providers/supabase-vault.provider.js";

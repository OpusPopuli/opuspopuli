/**
 * Secrets Provider Types
 *
 * Interfaces for secrets management operations (env vars, Supabase Vault, etc.)
 */

/**
 * Secrets provider configuration
 */
export interface ISecretsConfig {
  region: string;
}

/**
 * Secrets provider interface
 */
export interface ISecretsProvider {
  /**
   * Get provider name
   */
  getName(): string;

  /**
   * Get a secret value by ID
   */
  getSecret(secretId: string): Promise<string | undefined>;

  /**
   * Get multiple secrets by IDs
   */
  getSecrets?(secretIds: string[]): Promise<Record<string, string | undefined>>;

  /**
   * Get a secret as JSON object
   */
  getSecretJson?<T>(secretId: string): Promise<T | undefined>;
}

/**
 * Secrets error class
 */
export class SecretsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SecretsError";
  }
}

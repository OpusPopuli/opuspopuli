import { Injectable, Logger } from "@nestjs/common";
import { ISecretsProvider, SecretsError } from "@opuspopuli/common";

/**
 * Environment Variable Secrets Provider
 *
 * The simplest provider - reads secrets directly from process.env.
 * This is the universal adapter that works with any platform that
 * supports environment variable injection (Docker, K8s, GCP, Azure, etc.)
 *
 * Usage:
 *   SECRETS_PROVIDER=env (or omit - this is the default)
 *   Secrets are expected as environment variables:
 *     DB_PASSWORD=xxx
 *     JWT_SECRET=yyy
 */
@Injectable()
export class EnvProvider implements ISecretsProvider {
  private readonly logger = new Logger(EnvProvider.name);

  constructor() {
    this.logger.log(
      "EnvProvider initialized - reading secrets from process.env",
    );
  }

  getName(): string {
    return "EnvProvider";
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    const value = process.env[secretId];

    if (value === undefined) {
      this.logger.debug(`Secret not found in environment: ${secretId}`);
      return undefined;
    }

    this.logger.debug(`Retrieved secret from environment: ${secretId}`);
    return value;
  }

  async getSecrets(
    secretIds: string[],
  ): Promise<Record<string, string | undefined>> {
    const results: Record<string, string | undefined> = {};

    for (const secretId of secretIds) {
      results[secretId] = await this.getSecret(secretId);
    }

    return results;
  }

  async getSecretJson<T>(secretId: string): Promise<T | undefined> {
    const secret = await this.getSecret(secretId);
    if (!secret) return undefined;

    try {
      return JSON.parse(secret) as T;
    } catch (error) {
      this.logger.error(`Failed to parse secret as JSON: ${secretId}`);
      throw new SecretsError(
        `Failed to parse secret ${secretId} as JSON`,
        "PARSE_SECRET_ERROR",
        error as Error,
      );
    }
  }
}

/**
 * Helper function for bootstrap scenarios (before DI is available)
 */
export function getEnvSecret(secretName: string): string | undefined {
  return process.env[secretName];
}

/**
 * Helper function that throws if secret is not found
 */
export function getEnvSecretOrThrow(secretName: string): string {
  const value = process.env[secretName];
  if (!value) {
    throw new Error(`Required secret not found in environment: ${secretName}`);
  }
  return value;
}

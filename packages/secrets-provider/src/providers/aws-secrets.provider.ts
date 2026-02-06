import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { ISecretsProvider, SecretsError } from "@opuspopuli/common";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * AWS Secrets Manager Provider
 *
 * Retrieves secrets from AWS Secrets Manager with local caching
 * to minimize API calls and costs.
 *
 * Configuration:
 *   SECRETS_PROVIDER=aws
 *   AWS_REGION=us-east-1
 *   SECRETS_CACHE_TTL=300 (optional, seconds)
 *
 * Authentication:
 *   Uses default AWS credential chain (IAM role, env vars, etc.)
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/215
 */
@Injectable()
export class AWSSecretsProvider implements ISecretsProvider {
  private readonly logger = new Logger(AWSSecretsProvider.name);
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTTLMs: number;

  constructor(private configService: ConfigService) {
    const region =
      configService.get<string>("secrets.region") ||
      configService.get<string>("AWS_REGION");

    if (!region) {
      throw new SecretsError(
        "AWS_REGION is required for AWS Secrets Manager",
        "CONFIG_ERROR",
      );
    }

    this.client = new SecretsManagerClient({ region });
    this.cacheTTLMs =
      (configService.get<number>("secrets.cacheTTLSeconds") || 300) * 1000;

    this.logger.log(`AWSSecretsProvider initialized for region: ${region}`);
  }

  getName(): string {
    return "AWSSecretsProvider";
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache hit for secret: ${secretId}`);
      return cached.value;
    }

    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response = await this.client.send(command);

      const value = response.SecretString;
      if (!value) {
        this.logger.warn(`Secret has no string value: ${secretId}`);
        return undefined;
      }

      // Cache the result
      this.cache.set(secretId, {
        value,
        expiresAt: Date.now() + this.cacheTTLMs,
      });

      this.logger.log(`Retrieved secret from AWS: ${secretId}`);
      return value;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        this.logger.warn(`Secret not found in AWS: ${secretId}`);
        return undefined;
      }
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

    await Promise.all(
      secretIds.map(async (secretId) => {
        try {
          results[secretId] = await this.getSecret(secretId);
        } catch {
          this.logger.error(`Failed to retrieve secret: ${secretId}`);
          results[secretId] = undefined;
        }
      }),
    );

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

  /**
   * Clear cached secrets
   * @param secretId Optional specific secret to clear, or all if omitted
   */
  clearCache(secretId?: string): void {
    if (secretId) {
      this.cache.delete(secretId);
      this.logger.debug(`Cleared cache for secret: ${secretId}`);
    } else {
      this.cache.clear();
      this.logger.debug("Cleared all cached secrets");
    }
  }
}

/**
 * Helper function for bootstrap scenarios (before DI is available)
 */
export async function getAWSSecret(
  secretName: string,
  region?: string,
): Promise<string> {
  const awsRegion = region || process.env.AWS_REGION;

  if (!awsRegion) {
    throw new Error("AWS_REGION is required");
  }

  const client = new SecretsManagerClient({ region: awsRegion });
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);
  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no string value`);
  }

  return response.SecretString;
}

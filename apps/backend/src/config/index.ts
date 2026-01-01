import { ConfigService } from '@nestjs/config';
import { getSecrets } from '@qckstrt/secrets-provider';
import { createLogger, LogLevel } from '@qckstrt/logging-provider';
import { DBConnection, DBType } from 'src/common/enums/db.enums';

/**
 * Config logger for use during application initialization
 * before NestJS logger is available
 */
const configLogger = createLogger({
  serviceName: 'config',
  level: LogLevel.WARN,
});

export interface IAuthConfig {
  userPoolId: string;
  clientId: string;
}

export interface IDBLocalConfig {
  type: DBType;
  database: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface IDBRemoteConfig {
  type: DBType;
  database: string;
  secretArn: string;
  resourceArn: number;
}

export interface IDBConfig {
  connection: DBConnection;
  config: IDBLocalConfig | IDBRemoteConfig;
}

export interface IFileConfig {
  bucket: string;
  sqsUrl: string;
  snsTopicArn: string;
  snsRoleArn: string;
}

export interface IAIConfig {
  apiKey: string;
  gptModel: string;
  embeddingModel: string;
  batchSize: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface IAppConfig {
  project: string;
  application: string;
  version: string;
  description: string;
  port: number;
  region: string;
  apiKeys: Map<string, string>;
  auth: IAuthConfig;
  db: IDBConfig;
  file: IFileConfig;
  ai: IAIConfig;
}

export default async (): Promise<Partial<IAppConfig>> => {
  const configService = new ConfigService();

  const project = configService.get('PROJECT');
  const application = configService.get('APPLICATION');
  const version = configService.get('VERSION');
  const description = configService.get('DESCRIPTION');
  const port = configService.get('PORT');
  const region = configService.get('AWS_REGION');
  const nodeEnv = configService.get('NODE_ENV') || 'dev';

  if (
    !project ||
    !application ||
    !version ||
    !description ||
    !port ||
    !region
  ) {
    throw new Error(
      `Missing service configuration: PROJECT=${project} APPLICATION=${application} VERSION=${version} DESCRIPTION=${description} PORT=${port} AWS_REGION=${region}`,
    );
  }

  const baseConfig: Partial<IAppConfig> = {
    project,
    application,
    version,
    description,
    port,
    region,
  };

  // In dev mode, skip Vault and use environment variables directly
  if (nodeEnv === 'dev' || nodeEnv === 'development') {
    // Load API keys from environment variable in dev mode
    const apiKeysJson = configService.get('API_KEYS');
    if (apiKeysJson) {
      try {
        const apiKeysObj = JSON.parse(apiKeysJson);
        return {
          ...baseConfig,
          apiKeys: new Map<string, string>(Object.entries(apiKeysObj)),
        };
      } catch {
        configLogger.warn('Failed to parse API_KEYS environment variable');
      }
    }
    return baseConfig;
  }

  // In production, load secrets from Vault
  const awsSecrets = configService.get('AWS_SECRETS');
  if (awsSecrets) {
    try {
      const secrets = JSON.parse(await getSecrets(awsSecrets));

      if (secrets) {
        return {
          ...baseConfig,
          apiKeys: new Map<string, string>(
            Object.entries(secrets.apiKeys || {}),
          ),
          auth: secrets.auth as IAuthConfig,
          db: secrets.db as IDBConfig,
          file: secrets.file as IFileConfig,
          ai: secrets.ai as IAIConfig,
        };
      }
    } catch (error) {
      configLogger.warn(
        `Failed to load secrets from Vault: ${(error as Error).message}`,
      );
    }
  }

  return baseConfig;
};

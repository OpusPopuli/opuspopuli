import { ConfigService } from '@nestjs/config';
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

/**
 * Application Configuration Factory
 *
 * Loads configuration from environment variables.
 * With the federated secrets provider pattern, all secrets are available
 * as environment variables regardless of the underlying provider:
 * - Local dev: .env file
 * - AWS: Bootstrap script or ECS secrets injection
 * - Other platforms: Platform-native env var injection
 */
export default async (): Promise<Partial<IAppConfig>> => {
  const configService = new ConfigService();

  const project = configService.get('PROJECT');
  const application = configService.get('APPLICATION');
  const version = configService.get('VERSION');
  const description = configService.get('DESCRIPTION');
  const port = configService.get('PORT');
  const region = configService.get('AWS_REGION');

  if (!project || !application || !version || !description || !port) {
    throw new Error(
      `Missing service configuration: PROJECT=${project} APPLICATION=${application} VERSION=${version} DESCRIPTION=${description} PORT=${port}`,
    );
  }

  // Load API keys from environment variable
  const apiKeysJson = configService.get('API_KEYS');
  let apiKeys = new Map<string, string>();

  if (apiKeysJson) {
    try {
      const apiKeysObj = JSON.parse(apiKeysJson);
      apiKeys = new Map<string, string>(Object.entries(apiKeysObj));
    } catch {
      configLogger.warn('Failed to parse API_KEYS environment variable');
    }
  }

  return {
    project,
    application,
    version,
    description,
    port: typeof port === 'string' ? Number.parseInt(port, 10) : port,
    region: region || 'us-east-1',
    apiKeys,
  };
};

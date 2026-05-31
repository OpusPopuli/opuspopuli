import { INestApplication, Logger, Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import { env } from 'process';

import { ConfigService } from '@nestjs/config';
import { hydrateEnvFromVault } from '@opuspopuli/secrets-provider';
import { getHelmetOptions } from 'src/config/security-headers.config';
import { getCorsConfig } from 'src/config/cors.config';
import { GracefulShutdownService } from './services/graceful-shutdown.service';

const logger = new Logger('Bootstrap');

/**
 * Secrets sourced from Supabase Vault at bootstrap when
 * `SECRETS_PROVIDER=supabase`. Hydration runs before NestJS is
 * constructed so `@nestjs/config` factories see the Vault values.
 * Extended in follow-up PRs as more secrets migrate. See issue #786.
 */
const VAULT_BACKED_SECRETS = ['RESEND_API_KEY'] as const;

function setupSwagger(
  app: INestApplication,
  appName: string = 'app',
  appDescription: string = 'API',
  appVersion: string = '1.0.0',
) {
  const options = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(appDescription)
    .setVersion(appVersion)
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);
}

interface BootstrapOptions {
  portEnvVar?: string;
}

export default async function bootstrap(
  AppModule: Type<unknown>,
  options: BootstrapOptions = {},
): Promise<void> {
  const startTime = Date.now();

  // Vault → process.env hydration must run before NestFactory.create()
  // because @nestjs/config's registerAs factories read process.env at
  // module-init time. See issue #786.
  await hydrateEnvFromVault(VAULT_BACKED_SECRETS);

  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService>(ConfigService);

  // Use service-specific port env var if provided, otherwise fall back to 'port' from config
  const port = options.portEnvVar
    ? configService.get(options.portEnvVar) || configService.get('port')
    : configService.get('port');
  const appName = configService.get('application');
  const appDescription = configService.get('description');
  const appVersion = configService.get('version');

  // SECURITY: Configure helmet with comprehensive security headers
  // @see https://github.com/OpusPopuli/opuspopuli/issues/196
  app.use(helmet(getHelmetOptions()));
  app.use(cookieParser());

  // PERF-005: Enable response compression for bandwidth optimization
  // @see https://github.com/OpusPopuli/opuspopuli/issues/201
  app.use(
    compression({
      threshold: 1024, // Only compress responses > 1KB
      level: 6, // Balanced compression (1-9, higher = more compression)
    }),
  );

  app.enableCors(getCorsConfig(configService));

  // Enable global validation for DTOs with class-validator decorators
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      transform: true, // Auto-transform payloads to DTO instances
    }),
  );

  if (env.ENV !== 'prod') {
    setupSwagger(app, appName, appDescription, appVersion);
  }

  // INFRA-003: Enable graceful shutdown for Kubernetes SIGTERM handling
  // @see https://github.com/OpusPopuli/opuspopuli/issues/207
  app.enableShutdownHooks();

  // Initialize graceful shutdown service with HTTP server reference
  const gracefulShutdown = app.get(GracefulShutdownService);
  gracefulShutdown.setHttpServer(app.getHttpServer());

  await app.listen(port);
  const bootupTime = Date.now() - startTime;
  logger.log(`Now listening on port ${port} (bootup time: ${bootupTime}ms)`);
}

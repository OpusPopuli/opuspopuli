import serverlessExpress from '@codegenie/serverless-express';
import { INestApplication, Logger, Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Handler } from 'aws-lambda';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import helmet from 'helmet';

import { env } from 'process';

import { ConfigService } from '@nestjs/config';

/**
 * Get CORS configuration based on environment
 * In production, restricts origins to ALLOWED_ORIGINS env var
 * In development, allows all origins for easier testing
 */
function getCorsConfig(configService: ConfigService): CorsOptions {
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS');
  const isProd = env.ENV === 'prod';

  if (isProd && allowedOrigins) {
    const origins = allowedOrigins.split(',').map((o) => o.trim());
    return {
      origin: origins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400, // 24 hours
    };
  }

  // Development: allow all origins
  return {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-HMAC-Auth',
      'X-Requested-With',
      'user',
    ],
    credentials: true,
  };
}

const logger = new Logger('Bootstrap');

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
): Promise<Handler> {
  const startTime = Date.now();

  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService>(ConfigService);

  // Use service-specific port env var if provided, otherwise fall back to 'port' from config
  const port = options.portEnvVar
    ? configService.get(options.portEnvVar) || configService.get('port')
    : configService.get('port');
  const appName = configService.get('application');
  const appDescription = configService.get('description');
  const appVersion = configService.get('version');

  app.use(helmet());
  app.enableCors(getCorsConfig(configService));

  // Enable global validation for DTOs with class-validator decorators
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error for unknown properties
      transform: true, // Auto-transform payloads to DTO instances
    }),
  );

  if (env.ENV !== 'prod') {
    setupSwagger(app, appName, appDescription, appVersion);
  }

  await app.listen(port);
  const bootupTime = Date.now() - startTime;
  logger.log(`Now listening on port ${port} (bootup time: ${bootupTime}ms)`);

  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
}

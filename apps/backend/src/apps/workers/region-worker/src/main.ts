import 'src/common/tracing';
import { setGlobalHttpPool } from '@opuspopuli/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { preflightAndLoad } from 'src/common/preflight';

// Set undici headersTimeout before any fetch fires — default 300s would
// cut off slow Ollama responses on large contexts before our LLMError fires.
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

const logger = new Logger('RegionWorker');

async function bootstrap() {
  // Vault → process.env hydration MUST run before the worker module is
  // imported. ConfigModule.forRoot({validationSchema}) runs Joi validation
  // synchronously at @Module-decorator evaluation time. See #786 / #792.
  const { RegionWorkerModule } = await preflightAndLoad(
    () => import('./region-worker.module'),
  );

  const app = await NestFactory.create(RegionWorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  const port = parseInt(process.env.REGION_WORKER_PORT ?? '3005', 10);
  await app.listen(port);
  logger.log(`Region worker listening on port ${port}`);
}

bootstrap().catch((err: unknown) => {
  logger.error(
    `Region worker startup failed: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});

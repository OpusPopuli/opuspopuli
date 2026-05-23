import 'src/common/tracing';
import { setGlobalHttpPool } from '@opuspopuli/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { RegionWorkerModule } from './region-worker.module';

// Set undici headersTimeout before any fetch fires — default 300s would
// cut off slow Ollama responses on large contexts before our LLMError fires.
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

const logger = new Logger('RegionWorker');

async function bootstrap() {
  const app = await NestFactory.create(RegionWorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  const port = parseInt(process.env.REGION_WORKER_PORT ?? '3005', 10);
  await app.listen(port);
  logger.log(`Region worker listening on port ${port}`);
}

bootstrap();

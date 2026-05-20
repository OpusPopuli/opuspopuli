import 'src/common/tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { RegionWorkerModule } from './region-worker.module';

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

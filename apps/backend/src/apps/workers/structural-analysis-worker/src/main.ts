import 'src/common/tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { StructuralAnalysisWorkerModule } from './structural-analysis-worker.module';

const logger = new Logger('StructuralAnalysisWorker');

async function bootstrap() {
  const app = await NestFactory.create(StructuralAnalysisWorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  const port = parseInt(
    process.env.STRUCTURAL_ANALYSIS_WORKER_PORT ?? '3006',
    10,
  );
  await app.listen(port);
  logger.log(`Structural analysis worker listening on port ${port}`);
}

bootstrap();

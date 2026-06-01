import 'src/common/tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { preflightAndLoad } from 'src/common/preflight';

const logger = new Logger('StructuralAnalysisWorker');

async function bootstrap() {
  const { StructuralAnalysisWorkerModule } = await preflightAndLoad(
    () => import('./structural-analysis-worker.module'),
  );

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

bootstrap().catch((err: unknown) => {
  logger.error(
    `Structural analysis worker startup failed: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});

import 'src/common/tracing';
import { setGlobalHttpPool } from '@opuspopuli/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { preflightAndLoad } from 'src/common/preflight';

// Match region-worker: raise undici headersTimeout so slow Ollama
// responses on large bill contexts don't cut off before our LLMError fires.
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

const logger = new Logger('LlmRerankWorker');

async function bootstrap() {
  const { LlmRerankWorkerModule } = await preflightAndLoad(
    () => import('./llm-rerank-worker.module'),
  );

  const app = await NestFactory.create(LlmRerankWorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  const port = parseInt(process.env.LLM_RERANK_WORKER_PORT ?? '3006', 10);
  await app.listen(port);
  logger.log(`LLM rerank worker listening on port ${port}`);
}

bootstrap().catch((err: unknown) => {
  logger.error(
    `LLM rerank worker startup failed: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});

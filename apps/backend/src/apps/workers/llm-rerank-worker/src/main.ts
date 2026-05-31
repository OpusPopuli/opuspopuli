import 'src/common/tracing';
import { setGlobalHttpPool } from '@opuspopuli/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { LlmRerankWorkerModule } from './llm-rerank-worker.module';

// Match region-worker: raise undici headersTimeout so slow Ollama
// responses on large bill contexts don't cut off before our LLMError fires.
setGlobalHttpPool({ headersTimeoutMs: 1_350_000 });

const logger = new Logger('LlmRerankWorker');

async function bootstrap() {
  const app = await NestFactory.create(LlmRerankWorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();

  const port = parseInt(process.env.LLM_RERANK_WORKER_PORT ?? '3006', 10);
  await app.listen(port);
  logger.log(`LLM rerank worker listening on port ${port}`);
}

bootstrap();

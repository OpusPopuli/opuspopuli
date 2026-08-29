/**
 * Backfill: embed the filed-measure corpus for petition retrieval verification
 * (#1074, subtask 2).
 *
 * Usage:
 *   pnpm --filter backend build:region
 *   node dist/apps/region/src/scripts/backfill-proposition-embeddings.js
 *
 * Idempotent — a second run with unchanged text embeds nothing and reports
 * `unchanged`. Safe to run repeatedly, and safe to re-run after an interrupted
 * pass: rows whose hash was written but whose vector was not are re-embedded
 * rather than skipped.
 *
 * The script is deliberately a thin bootstrap. All behaviour lives in
 * PropositionEmbeddingService so it is reachable by tests through normal DI —
 * importing AppModule from a spec pulls the whole graph into the Jest worker
 * and has previously killed CI workers outright.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PropositionEmbeddingService } from '../domains/proposition-embedding.service';

async function main(): Promise<void> {
  const logger = new Logger('backfill-proposition-embeddings');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const embedder = app.get(PropositionEmbeddingService, { strict: false });
    logger.log('Embedding filed measures…');
    const result = await embedder.embedMissing();
    logger.log(
      `Done. scanned=${result.scanned} embedded=${result.embedded} unchanged=${result.unchanged} failed=${result.failed}`,
    );
    // A partial run is a failure worth surfacing to whoever ran it: the corpus
    // is incomplete and retrieval will silently miss those measures.
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

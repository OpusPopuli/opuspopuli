import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { EMBEDDING_DIMENSIONS } from '@opuspopuli/common';
import { createHash } from 'node:crypto';

/**
 * Embeds the filed-measure corpus so a scanned petition can be matched to the
 * measure it actually is (#1074, subtask 2).
 *
 * Today that match is a case-insensitive substring search in
 * `linking.service.ts`, which writes a hardcoded `confidence: 0.8` onto every
 * link. Nothing downstream depends on the match being right, which is exactly
 * why a constant could sit there unnoticed. Retrieval replaces both.
 */
@Injectable()
export class PropositionEmbeddingService implements OnModuleInit {
  /**
   * Fail loudly and immediately on a provider/column width mismatch.
   *
   * Without this the failure is a per-row throw during the backfill —
   * `failed=52, embedded=0` buried in a log — or, worse, every scan silently
   * degrading to `unverified` with no indication why. Switching
   * EMBEDDINGS_PROVIDER to a different-width model needs a migration, and this
   * is what says so at the moment it matters.
   */
  onModuleInit(): void {
    const actual = this.embeddings.getProviderInfo().dimensions;
    if (actual !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embeddings provider produces ${actual}-dimension vectors but the ` +
          `embedding columns are vector(${EMBEDDING_DIMENSIONS}). Switching ` +
          `provider or model requires a migration — see EMBEDDING_DIMENSIONS ` +
          `in @opuspopuli/common.`,
      );
    }
  }

  private readonly logger = new Logger(PropositionEmbeddingService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * The text we actually embed: the identifying header, not the whole filing.
   *
   * ── Why not fullText ─────────────────────────────────────────────────────
   *
   * The plan of record said to embed `fullText`. Measuring the corpus first
   * showed that is wrong on two counts:
   *
   *  1. **It silently truncates.** Filed measures run to 115,077 characters and
   *     13 of the 52 exceed a typical 8k-token embedding window. A single
   *     embedding call would quietly drop the tail of a quarter of the corpus,
   *     and nothing would surface that.
   *  2. **It compares unlike things.** A scan yields ~1,213 characters — the
   *     top of one photographed sheet. Averaging a 14,000-character filing into
   *     one vector and comparing it to that is not a like-for-like match.
   *
   * Title plus summary is present for all 52 rows, runs 47–609 characters
   * (median 385), and is the same artefact the scan actually captures: the
   * Attorney General's circulating title and summary sit at the top of the
   * sheet, which is the region #1075's on-device crop deliberately keeps.
   *
   * If the OCR-coverage measurement (subtask 1) shows the header does not
   * survive photography, this decision changes — and `embeddingSourceHash`
   * makes that cheap. Changing this function changes every hash, so the next
   * run re-embeds the whole corpus with no manual cleanup.
   */
  static embeddingSource(p: { title: string; summary: string | null }): string {
    return [p.title, p.summary ?? ''].join('\n\n').trim();
  }

  /** SHA-256 over the exact string that was embedded. */
  static sourceHash(source: string): string {
    return createHash('sha256').update(source).digest('hex');
  }

  /**
   * Embed every proposition whose vector is missing or stale.
   *
   * Idempotent by construction: a second run with unchanged text embeds
   * nothing. Proposition sync runs often and `fullText` rarely changes, so
   * without the hash check every sync would pay for inference to produce
   * vectors identical to the ones already stored.
   */
  async embedMissing(): Promise<{
    scanned: number;
    embedded: number;
    unchanged: number;
    failed: number;
  }> {
    const propositions = await this.db.proposition.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        externalId: true,
        title: true,
        summary: true,
        embeddingSourceHash: true,
      },
    });

    let embedded = 0;
    let unchanged = 0;
    let failed = 0;

    for (const p of propositions) {
      const source = PropositionEmbeddingService.embeddingSource(p);

      if (!source) {
        this.logger.warn(
          `Proposition ${p.externalId} has no title or summary to embed; skipping`,
        );
        failed++;
        continue;
      }

      const hash = PropositionEmbeddingService.sourceHash(source);

      // Also re-embeds when the vector is missing but the hash is somehow
      // present — a half-written row from an interrupted run should heal on
      // the next pass rather than be skipped forever.
      if (p.embeddingSourceHash === hash && (await this.hasVector(p.id))) {
        unchanged++;
        continue;
      }

      try {
        // getEmbeddingsForQuery, NOT getEmbeddingsForText: the latter chunks
        // and returns an array, and this column holds exactly one vector. The
        // source is short by design, so there is nothing to chunk.
        const vector = await this.embeddings.getEmbeddingsForQuery(source);
        await this.writeVector(p.id, vector, hash);
        embedded++;
      } catch (error) {
        // Per-row isolation: one measure with unusual text must not abort the
        // corpus. The run reports the count and the next run retries it.
        this.logger.error(
          `Failed to embed proposition ${p.externalId}: ${error}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Proposition embeddings: scanned=${propositions.length} embedded=${embedded} unchanged=${unchanged} failed=${failed}`,
    );

    return { scanned: propositions.length, embedded, unchanged, failed };
  }

  private async hasVector(id: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<{ present: boolean }[]>`
      SELECT (embedding IS NOT NULL) AS present
      FROM propositions WHERE id = ${id}
    `;
    return rows[0]?.present === true;
  }

  /**
   * Prisma cannot write an `Unsupported("vector")` column through the
   * typed client, so this goes through raw SQL.
   *
   * The vector is validated and rebuilt from numbers rather than interpolated
   * as text: `$executeRaw` parameterises `${...}`, but a pgvector literal has
   * to be a single string, and building that string from unvalidated input
   * would be the one place an injection could hide.
   *
   * No `::uuid` cast on `id`. Prisma declares it `String @id @default(uuid())`
   * with no `@db.Uuid`, so the column is TEXT — casting the parameter yields
   * `text = uuid` and Postgres refuses it (42883). The integration test caught
   * this; nothing in the type system could.
   */
  private async writeVector(
    id: string,
    vector: number[],
    hash: string,
  ): Promise<void> {
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector?.length ?? 'none'}`,
      );
    }
    if (!vector.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error('Embedding contains a non-finite value');
    }

    const literal = `[${vector.join(',')}]`;

    await this.db.$executeRaw`
      UPDATE propositions
      SET embedding = ${literal}::vector,
          embedding_source_hash = ${hash},
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }
}

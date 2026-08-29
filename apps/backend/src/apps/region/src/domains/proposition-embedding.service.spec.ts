import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import {
  PropositionEmbeddingService,
  EMBEDDING_DIMENSIONS,
} from './proposition-embedding.service';

/**
 * The corpus side of petition retrieval verification (#1074).
 *
 * Two behaviours carry real cost if they regress: embedding text we did not
 * intend to embed, and re-embedding unchanged text on every sync.
 */

const vector = (fill = 0.1) => Array<number>(EMBEDDING_DIMENSIONS).fill(fill);

describe('PropositionEmbeddingService', () => {
  let service: PropositionEmbeddingService;
  let db: {
    proposition: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let embeddings: { getEmbeddingsForQuery: jest.Mock };

  beforeEach(async () => {
    db = {
      proposition: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ present: true }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    embeddings = {
      getEmbeddingsForQuery: jest.fn().mockResolvedValue(vector()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PropositionEmbeddingService,
        { provide: DbService, useValue: db },
        { provide: EmbeddingsService, useValue: embeddings },
      ],
    }).compile();

    service = moduleRef.get(PropositionEmbeddingService);
  });

  describe('embeddingSource', () => {
    /**
     * The plan said to embed `fullText`. Measuring the corpus showed 13 of 52
     * filed measures exceed a typical 8k-token window, so a single embedding
     * call would silently truncate a quarter of them — and a 14,000-character
     * filing averaged into one vector is not comparable to the ~1,200
     * characters a photograph actually yields.
     */
    it('embeds the identifying header, not the whole filing', () => {
      const source = PropositionEmbeddingService.embeddingSource({
        title: 'ESTABLISHES VOTER IDENTIFICATION REQUIREMENTS',
        summary: 'Requires voters to present identification.',
      });

      expect(source).toContain('ESTABLISHES VOTER IDENTIFICATION');
      expect(source).toContain('Requires voters to present identification.');
    });

    it('tolerates a missing summary', () => {
      expect(
        PropositionEmbeddingService.embeddingSource({
          title: 'A MEASURE',
          summary: null,
        }),
      ).toBe('A MEASURE');
    });

    /** The hash must follow the source, or a change to one silently desyncs. */
    it('changes its hash when the source changes', () => {
      const a = PropositionEmbeddingService.sourceHash('one');
      const b = PropositionEmbeddingService.sourceHash('two');

      expect(a).not.toBe(b);
      expect(PropositionEmbeddingService.sourceHash('one')).toBe(a);
    });
  });

  describe('embedMissing', () => {
    const row = (over: Partial<Record<string, unknown>> = {}) => ({
      id: '11111111-1111-1111-1111-111111111111',
      externalId: '25-0007A1',
      title: 'ESTABLISHES VOTER IDENTIFICATION REQUIREMENTS',
      summary: 'Requires identification.',
      embeddingSourceHash: null,
      ...over,
    });

    it('embeds a proposition that has no vector yet', async () => {
      db.proposition.findMany.mockResolvedValue([row()]);

      const result = await service.embedMissing();

      expect(embeddings.getEmbeddingsForQuery).toHaveBeenCalledTimes(1);
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ scanned: 1, embedded: 1, unchanged: 0 });
    });

    /**
     * The reason `embedding_source_hash` exists. Proposition sync runs often
     * and the filed text rarely changes; without this, every sync pays for
     * inference to produce vectors identical to the stored ones.
     */
    it('skips text that has not changed', async () => {
      const source = PropositionEmbeddingService.embeddingSource(row());
      db.proposition.findMany.mockResolvedValue([
        row({
          embeddingSourceHash: PropositionEmbeddingService.sourceHash(source),
        }),
      ]);

      const result = await service.embedMissing();

      expect(embeddings.getEmbeddingsForQuery).not.toHaveBeenCalled();
      expect(result).toMatchObject({ embedded: 0, unchanged: 1 });
    });

    it('re-embeds when the text changed under a stale hash', async () => {
      db.proposition.findMany.mockResolvedValue([
        row({ embeddingSourceHash: 'a-hash-of-some-older-text' }),
      ]);

      const result = await service.embedMissing();

      expect(embeddings.getEmbeddingsForQuery).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ embedded: 1, unchanged: 0 });
    });

    /**
     * A run interrupted between writing the vector and committing — or the
     * reverse — must heal on the next pass rather than be skipped forever on
     * the strength of its hash alone.
     */
    it('re-embeds when the hash matches but the vector is missing', async () => {
      const source = PropositionEmbeddingService.embeddingSource(row());
      db.proposition.findMany.mockResolvedValue([
        row({
          embeddingSourceHash: PropositionEmbeddingService.sourceHash(source),
        }),
      ]);
      db.$queryRaw.mockResolvedValue([{ present: false }]);

      const result = await service.embedMissing();

      expect(embeddings.getEmbeddingsForQuery).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ embedded: 1 });
    });

    /** One odd measure must not abort the corpus. */
    it('isolates a failure to the row that caused it', async () => {
      db.proposition.findMany.mockResolvedValue([
        row({ id: '11111111-1111-1111-1111-111111111111' }),
        row({
          id: '22222222-2222-2222-2222-222222222222',
          externalId: '26-0001',
        }),
      ]);
      embeddings.getEmbeddingsForQuery
        .mockRejectedValueOnce(new Error('provider blew up'))
        .mockResolvedValueOnce(vector());

      const result = await service.embedMissing();

      expect(result).toMatchObject({ scanned: 2, embedded: 1, failed: 1 });
    });

    it('reports a row with nothing to embed rather than embedding empty text', async () => {
      db.proposition.findMany.mockResolvedValue([
        row({ title: '', summary: null }),
      ]);

      const result = await service.embedMissing();

      expect(embeddings.getEmbeddingsForQuery).not.toHaveBeenCalled();
      expect(result).toMatchObject({ embedded: 0, failed: 1 });
    });

    /**
     * A wrong-width vector must never reach the column. pgvector would reject
     * the cast, but failing here names the cause instead of surfacing a raw
     * SQL error, and keeps `documents.embedding` and `propositions.embedding`
     * provably comparable.
     */
    it('refuses a vector of the wrong dimensionality', async () => {
      db.proposition.findMany.mockResolvedValue([row()]);
      embeddings.getEmbeddingsForQuery.mockResolvedValue([0.1, 0.2, 0.3]);

      const result = await service.embedMissing();

      expect(db.$executeRaw).not.toHaveBeenCalled();
      expect(result).toMatchObject({ embedded: 0, failed: 1 });
    });

    it('refuses a vector containing a non-finite value', async () => {
      db.proposition.findMany.mockResolvedValue([row()]);
      const bad = vector();
      bad[0] = Number.NaN;
      embeddings.getEmbeddingsForQuery.mockResolvedValue(bad);

      const result = await service.embedMissing();

      expect(db.$executeRaw).not.toHaveBeenCalled();
      expect(result).toMatchObject({ embedded: 0, failed: 1 });
    });
  });
});

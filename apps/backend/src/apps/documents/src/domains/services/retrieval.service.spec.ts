import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MetricsService } from 'src/common/metrics';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { EMBEDDING_DIMENSIONS } from '@opuspopuli/common';
import {
  RetrievalService,
  MIN_RETRIEVAL_OCR_CONFIDENCE,
  MIN_VERIFIED_SIMILARITY,
} from './retrieval.service';

/**
 * Matching a scanned petition to the filed measure it actually is (#1074).
 *
 * The property that matters most is not that a match is found — it is that a
 * failure to match never costs the user their scan. Retrieval is enrichment
 * layered onto an analysis path that worked before it existed, and every
 * failure mode here has to degrade to `unverified`.
 */

const vector = (fill = 0.1) => Array<number>(EMBEDDING_DIMENSIONS).fill(fill);

describe('RetrievalService', () => {
  let service: RetrievalService;
  let db: { $executeRaw: jest.Mock; $queryRaw: jest.Mock };
  let embeddings: { getEmbeddingsForQuery: jest.Mock };
  let metrics: { recordPetitionRetrieval: jest.Mock };

  const row = (distance: number) => [
    {
      id: 'prop-1',
      external_id: '25-0007A1',
      title: 'ESTABLISHES ADDITIONAL VOTER IDENTIFICATION REQUIREMENTS',
      distance,
    },
  ];

  beforeEach(async () => {
    db = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue(row(0.1)),
    };
    embeddings = {
      getEmbeddingsForQuery: jest.fn().mockResolvedValue(vector()),
    };
    metrics = { recordPetitionRetrieval: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: DbService, useValue: db },
        { provide: EmbeddingsService, useValue: embeddings },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = moduleRef.get(RetrievalService);
  });

  it('returns the closest filing with a real similarity score', async () => {
    const out = await service.findBestMatch('doc-1', 'petition text', 85);

    expect(out.attempted).toBe(true);
    expect(out.match).toMatchObject({
      propositionId: 'prop-1',
      externalId: '25-0007A1',
    });
    // 1 - cosine distance. Not the hardcoded 0.8 this replaces.
    expect(out.match!.similarity).toBeCloseTo(0.9, 6);
    expect(out.match!.verified).toBe(true);
  });

  it('falls short of verified below the similarity threshold', async () => {
    db.$queryRaw.mockResolvedValue(row(1 - (MIN_VERIFIED_SIMILARITY - 0.05)));

    const out = await service.findBestMatch('doc-1', 'petition text', 85);

    expect(out.match).not.toBeNull();
    expect(out.match!.verified).toBe(false);
  });

  /**
   * Matching noise does not fail loudly — it returns the nearest of 52 vectors
   * with a plausible-looking score. A similarity threshold cannot tell a weak
   * genuine match from a confident match on garbage, so the confidence gate
   * has to sit upstream of it.
   */
  it('does not attempt retrieval on a low-confidence extraction', async () => {
    const out = await service.findBestMatch(
      'doc-1',
      'noise'.repeat(600),
      MIN_RETRIEVAL_OCR_CONFIDENCE - 1,
    );

    expect(out.attempted).toBe(false);
    expect(out.skippedReason).toBe('low_ocr_confidence');
    expect(embeddings.getEmbeddingsForQuery).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  /** PDF and plain-text extraction is deterministic and records no score. */
  it('attempts retrieval when no confidence was recorded', async () => {
    const out = await service.findBestMatch('doc-1', 'petition text', null);

    expect(out.attempted).toBe(true);
    expect(embeddings.getEmbeddingsForQuery).toHaveBeenCalled();
  });

  it('skips empty text without calling the provider', async () => {
    const out = await service.findBestMatch('doc-1', '   ', 90);

    expect(out.skippedReason).toBe('no_text');
    expect(embeddings.getEmbeddingsForQuery).not.toHaveBeenCalled();
  });

  it('reports an empty corpus rather than inventing a match', async () => {
    db.$queryRaw.mockResolvedValue([]);

    const out = await service.findBestMatch('doc-1', 'petition text', 85);

    expect(out.match).toBeNull();
    expect(out.skippedReason).toBe('empty_corpus');
  });

  /**
   * The whole point. A retrieval outage must cost the user a label, never
   * their scan — the analysis path worked before this existed and has to keep
   * working when it breaks.
   */
  it.each([
    [
      'the embedding provider throws',
      () =>
        embeddings.getEmbeddingsForQuery.mockRejectedValue(new Error('down')),
    ],
    [
      'the provider returns a wrong-width vector',
      () => embeddings.getEmbeddingsForQuery.mockResolvedValue([1, 2, 3]),
    ],
    [
      'the corpus query throws',
      () => db.$queryRaw.mockRejectedValue(new Error('pgvector exploded')),
    ],
  ])('degrades to no match when %s', async (_label, arrange) => {
    arrange();

    const out = await service.findBestMatch('doc-1', 'petition text', 85);

    expect(out.match).toBeNull();
    expect(out.attempted).toBe(true);
  });

  /**
   * Scans embed to documents.embedding rather than through IVectorDBProvider,
   * which persists `content` alongside every vector and would create a second
   * at-rest copy of user text.
   */
  it('writes the scan vector to the document row', async () => {
    await service.findBestMatch('doc-1', 'petition text', 85);

    const sql = db.$executeRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('UPDATE documents');
    expect(sql).toContain('embedding');
  });
  /**
   * The threshold was 0.82 by judgement until it was measured; correct matches
   * scored 0.545 and 0.586, so nothing would EVER have been verified and
   * nothing would have said so. This telemetry is how that gets noticed.
   */
  describe('telemetry (#1074 subtask 7)', () => {
    it('records the similarity of every completed match', async () => {
      await service.findBestMatch('doc-1', 'petition text', 85);

      expect(metrics.recordPetitionRetrieval).toHaveBeenCalledWith(
        'documents-service',
        'verified',
        expect.closeTo(0.9, 6),
      );
    });

    it.each([
      ['skipped_low_ocr_confidence', 'text', 10],
      ['skipped_no_text', '   ', 90],
    ])('records %s without a score', async (outcome, text, conf) => {
      await service.findBestMatch('doc-1', text as string, conf as number);

      expect(metrics.recordPetitionRetrieval).toHaveBeenCalledWith(
        'documents-service',
        outcome,
      );
    });

    it('records a failure rather than staying silent', async () => {
      embeddings.getEmbeddingsForQuery.mockRejectedValue(new Error('down'));

      await service.findBestMatch('doc-1', 'petition text', 85);

      expect(metrics.recordPetitionRetrieval).toHaveBeenCalledWith(
        'documents-service',
        'failed',
      );
    });
  });
});

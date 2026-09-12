import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MetricsService } from 'src/common/metrics';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { EMBEDDING_DIMENSIONS } from '@opuspopuli/common';
import {
  RetrievalService,
  MIN_RETRIEVAL_OCR_CONFIDENCE,
  MIN_VERIFIED_SIMILARITY,
  VERIFICATION_CALIBRATION,
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
  let db: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    documentProposition: { upsert: jest.Mock };
  };
  let embeddings: {
    getEmbeddingsForQuery: jest.Mock;
    getProviderInfo: jest.Mock;
    assertProviderReady: jest.Mock;
  };
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
      documentProposition: { upsert: jest.fn().mockResolvedValue({}) },
    };
    embeddings = {
      getEmbeddingsForQuery: jest.fn().mockResolvedValue(vector()),
      // The model is recorded onto the row alongside the vector (#1156): half
      // of the staleness key, and the only way to tell afterwards which
      // encoder produced a stored embedding.
      // The CALIBRATED model by default, so the threshold tests below keep
      // testing the threshold. The calibration gate has its own describe block.
      getProviderInfo: jest.fn().mockReturnValue({
        model: VERIFICATION_CALIBRATION.model,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      assertProviderReady: jest.fn().mockResolvedValue(undefined),
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
  /**
   * A similarity threshold belongs to one model's space, not to the task.
   *
   * 0.50 was measured against MiniLM-384 from nine photographs. Under
   * bge-base-768 a well-formed initiative that was NEVER FILED scores 0.7577
   * against an unrelated measure — it would be labelled `verified` and get an
   * auto_retrieval link asserting that identity. Under nomic, correct matches
   * score 0.4-0.5 and the same constant verifies almost nothing. Wrong in both
   * directions, so a threshold applied to a model it was not measured against
   * makes no judgement at all.
   */
  /**
   * Every way of being wrong about embeddings should be caught at boot, in one
   * place: wrong provider width, wrong column width, and a model that was never
   * pulled. The last was rehearsed against a real daemon — the service starts
   * clean and then fails per row with a 404, behind a green health check.
   */
  describe('startup checks (#1156)', () => {
    const columnWidth = (width: number) =>
      db.$queryRaw.mockResolvedValue([{ width }]);

    it('verifies the provider can actually serve embeddings', async () => {
      columnWidth(EMBEDDING_DIMENSIONS);

      await service.onModuleInit();

      expect(embeddings.assertProviderReady).toHaveBeenCalled();
    });

    it('refuses to start when the model is not available', async () => {
      columnWidth(EMBEDDING_DIMENSIONS);
      embeddings.assertProviderReady.mockRejectedValue(
        new Error(
          'Ollama model "nomic-embed-text-v2-moe:latest" is not installed',
        ),
      );

      await expect(service.onModuleInit()).rejects.toThrow(/not installed/);
    });

    it('refuses to start when the column width disagrees', async () => {
      columnWidth(384);

      await expect(service.onModuleInit()).rejects.toThrow(/is vector\(384\)/);
    });
  });

  describe('calibration gate (#1156)', () => {
    beforeEach(() => {
      embeddings.getProviderInfo.mockReturnValue({
        model: 'Xenova/bge-base-en-v1.5',
        dimensions: EMBEDDING_DIMENSIONS,
      });
      // Comfortably over the threshold — the point is that it does not matter.
      db.$queryRaw.mockResolvedValue(row(1 - 0.95));
    });

    it('never verifies under a model the threshold was not measured against', async () => {
      const out = await service.findBestMatch('doc-1', 'text', 90);

      expect(out.match).not.toBeNull();
      expect(out.match!.similarity).toBeCloseTo(0.95, 6);
      expect(out.match!.verified).toBe(false);
      expect(out.uncalibrated).toBe(true);
    });

    it('writes no link when it cannot verify', async () => {
      await service.findBestMatch('doc-1', 'text', 90);

      expect(db.documentProposition.upsert).not.toHaveBeenCalled();
    });

    /**
     * `uncalibrated` is the ABSENCE of a verdict, not a negative one. Counting
     * it as `unverified` would show a dark feature as a working one whose
     * matches simply score low.
     */
    it('reports uncalibrated separately from unverified', async () => {
      await service.findBestMatch('doc-1', 'text', 90);

      expect(metrics.recordPetitionRetrieval).toHaveBeenCalledWith(
        expect.any(String),
        'uncalibrated',
        expect.closeTo(0.95, 6),
      );
    });

    it('still verifies under the calibrated model', async () => {
      embeddings.getProviderInfo.mockReturnValue({
        model: VERIFICATION_CALIBRATION.model,
        dimensions: EMBEDDING_DIMENSIONS,
      });

      const out = await service.findBestMatch('doc-1', 'text', 90);

      expect(out.match!.verified).toBe(true);
      expect(out.uncalibrated).toBeUndefined();
    });
  });

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
  /**
   * Phase B (#1074): the match has to become a link, or it exists only inside
   * the analysis JSON and nothing downstream can act on it — including the
   * query that carries the filing's own analysis onto the scan surface.
   */
  describe('linking a verified match', () => {
    it('links with the measured similarity, not a constant', async () => {
      await service.findBestMatch('doc-1', 'petition text', 85);

      expect(db.documentProposition.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            documentId: 'doc-1',
            propositionId: 'prop-1',
            linkSource: 'auto_retrieval',
            confidence: expect.closeTo(0.9, 6),
          }),
        }),
      );
    });

    /**
     * Linking a below-threshold guess would place a measure's authoritative
     * analysis beside a scan we are not confident is that measure — the
     * "confident analysis of the wrong filing" failure this issue exists to
     * avoid.
     */
    it('does not link a match below the threshold', async () => {
      db.$queryRaw.mockResolvedValue(row(1 - (MIN_VERIFIED_SIMILARITY - 0.05)));

      const out = await service.findBestMatch('doc-1', 'petition text', 85);

      expect(out.match!.verified).toBe(false);
      expect(db.documentProposition.upsert).not.toHaveBeenCalled();
    });

    /**
     * auto_retrieval, never auto_analysis: those links all carry a hardcoded
     * 0.8, and merging the two would make a measured score indistinguishable
     * from that constant.
     */
    it('never writes the legacy auto_analysis source', async () => {
      await service.findBestMatch('doc-1', 'petition text', 85);

      const arg = db.documentProposition.upsert.mock.calls[0][0];
      expect(arg.create.linkSource).not.toBe('auto_analysis');
    });

    /** A link failure costs a cross-reference; throwing would cost the scan. */
    it('still returns the match when linking fails', async () => {
      db.documentProposition.upsert.mockRejectedValue(
        new Error('fk violation'),
      );

      const out = await service.findBestMatch('doc-1', 'petition text', 85);

      expect(out.match).not.toBeNull();
      expect(out.match!.verified).toBe(true);
    });
  });
});

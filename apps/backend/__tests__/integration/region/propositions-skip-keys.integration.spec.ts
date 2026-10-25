/**
 * Propositions Phase B skip keys against a real database
 * (`docs/plans/propositions-phase-b.md` §1).
 *
 * Both claims are database claims a mock would only restate:
 *
 * - K-P1: a parse recorded for archived bytes comes back for the same parser
 *   version and not for another, and a newer version replaces it.
 * - K-P2: the analysis selector's new arms behave under SQL's NULL rules —
 *   `col <> x` is NULL, not true, for a NULL column, which is why each axis
 *   needs an explicit null arm — and the legacy backfill stamps exactly the
 *   rows that are current on every other axis.
 */
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PropositionAnalysisService,
  propositionAnalysisConfigHash,
} from '../../../src/apps/region/src/domains/proposition-analysis.service';
import { SourceVersionService } from '../../../src/apps/region/src/domains/source-version.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

const PROMPT_HASH = 'p'.repeat(64);
const DIGEST = 'weights-a';
const CONFIG = propositionAnalysisConfigHash(6000);

const VALID_ANALYSIS = JSON.stringify({
  analysisSummary: 'Raises the transfer tax.',
  keyProvisions: ['Raises the tax'],
  fiscalImpact: 'Increases revenue.',
  yesOutcome: 'A yes vote raises the tax.',
  noOutcome: 'A no vote keeps the current rate.',
  existingVsProposed: { current: 'Current rate', proposed: 'Higher rate' },
  analysisSections: [],
  analysisClaims: [],
});

describe('propositions Phase B skip keys (real DB)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('K-P1: parsed PDF text on source_versions', () => {
    const archive = async () => {
      const content = Buffer.from('%PDF-1.6 the measure');
      const { sourceVersionId } = await new SourceVersionService(db).record({
        content,
        contentHash: createHash('sha256').update(content).digest('hex'),
        sourceUrl: 'https://oag.ca.gov/m.pdf',
        fetchedAt: new Date().toISOString(),
        dataType: 'propositions',
      });
      return sourceVersionId!;
    };

    it('returns a recorded parse for its own parser version only', async () => {
      const versions = new SourceVersionService(db);
      const id = await archive();

      await expect(
        versions.getParsedText(id, 'pdf-1'),
      ).resolves.toBeUndefined();
      await expect(
        versions.attachParsedText(id, 'pdf-1', 'SECTION 1. The tax.'),
      ).resolves.toBe(true);

      await expect(versions.getParsedText(id, 'pdf-1')).resolves.toBe(
        'SECTION 1. The tax.',
      );
      await expect(
        versions.getParsedText(id, 'pdf-2'),
      ).resolves.toBeUndefined();
      const row = await db.sourceVersion.findUniqueOrThrow({ where: { id } });
      expect(row.parsedTextHash).toBe(sha256('SECTION 1. The tax.'));
    });

    it('lets a newer parser replace an older parse — nothing cites a parse', async () => {
      const versions = new SourceVersionService(db);
      const id = await archive();
      await versions.attachParsedText(id, 'pdf-1', 'old text');

      await versions.attachParsedText(id, 'pdf-2', 'new text');

      await expect(versions.getParsedText(id, 'pdf-2')).resolves.toBe(
        'new text',
      );
      await expect(
        versions.getParsedText(id, 'pdf-1'),
      ).resolves.toBeUndefined();
    });

    it('keeps derived_text, the subject row’s text, untouched', async () => {
      const versions = new SourceVersionService(db);
      const id = await archive();
      await versions.attachDerivedText(id, 'what the row stored');

      await versions.attachParsedText(id, 'pdf-1', 'what the parser made');

      const row = await db.sourceVersion.findUniqueOrThrow({ where: { id } });
      expect(row.derivedText).toBe('what the row stored');
    });
  });

  describe('K-P2: the analysis skip key', () => {
    let digest: string | undefined;
    let generate: jest.Mock;

    const service = () =>
      new PropositionAnalysisService(
        { get: () => undefined } as unknown as ConfigService,
        {
          getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
            promptText: 'rendered prompt',
            promptHash: PROMPT_HASH,
            promptVersion: 'v4',
          }),
          getPromptHash: jest.fn().mockResolvedValue(PROMPT_HASH),
        } as unknown as PromptClientService,
        {
          getModelName: () => 'nemotron-it',
          getModelDigest: async () => digest,
          generate,
        } as unknown as ILLMProvider,
        db,
      );

    const FULL_TEXT = 'SECTION 1. The documentary transfer tax is raised.';

    /** A measure analysed by `analysis` (all axes current unless overridden). */
    const seed = (externalId: string, analysis: Record<string, unknown> = {}) =>
      db.proposition.create({
        data: {
          externalId,
          title: `Measure ${externalId}`,
          summary: 'A measure.',
          status: 'qualified',
          fullText: FULL_TEXT,
          analysisSummary: 'existing analysis',
          analysisGeneratedAt: new Date('2026-10-20T00:00:00Z'),
          analysisPromptHash: PROMPT_HASH,
          analysisLlmDigest: DIGEST,
          analysisSourceTextHash: sha256(FULL_TEXT),
          analysisConfigHash: CONFIG,
          ...analysis,
        },
      });

    beforeEach(() => {
      digest = DIGEST;
      generate = jest.fn(async () => ({ text: VALID_ANALYSIS }));
    });

    const analysed = async (externalId: string) =>
      (await db.proposition.findFirstOrThrow({ where: { externalId } }))
        .analysisSummary !== 'existing analysis';

    it('regenerates exactly the measures stale on some axis', async () => {
      await seed('current');
      await seed('other-weights', { analysisLlmDigest: 'weights-b' });
      await seed('no-digest', { analysisLlmDigest: null });
      await seed('other-config', { analysisConfigHash: 'x'.repeat(64) });
      await seed('other-prompt', { analysisPromptHash: 'q'.repeat(64) });
      await seed('other-text', { analysisSourceTextHash: 'y'.repeat(64) });

      await service().generateMissing();

      const result = Object.fromEntries(
        await Promise.all(
          [
            'current',
            'other-weights',
            'no-digest',
            'other-config',
            'other-prompt',
            'other-text',
          ].map(async (id) => [id, await analysed(id)]),
        ),
      );
      expect(result).toEqual({
        current: false,
        'other-weights': true,
        'no-digest': true,
        'other-config': true,
        'other-prompt': true,
        'other-text': true,
      });
    });

    it('counts the current measures as the exact complement of the stale ones', async () => {
      // `current` is `NOT (stale arms)`. In SQL a NULL column makes `<>`
      // NULL, and NOT NULL is NULL — a row matching neither side would vanish
      // from both counts. Each axis pairs its `<>` with an IS NULL arm; this
      // proves it on Postgres, NULL columns included.
      await seed('current-a');
      await seed('current-b');
      await seed('no-digest', { analysisLlmDigest: null });
      await seed('never-analysed', {
        analysisGeneratedAt: null,
        analysisPromptHash: null,
        analysisSourceTextHash: null,
      });
      await seed('other-text', { analysisSourceTextHash: 'y'.repeat(64) });
      await seed('no-text', { fullText: '' });

      const { pending, current } = await service().stampAndSelectStale();

      expect(current).toBe(2);
      expect(pending.map((p) => p.externalId).sort()).toEqual([
        'never-analysed',
        'no-digest',
        'other-text',
      ]);
      // Every analysable row is on exactly one side; the empty text on none.
      expect(pending.length + current).toBe(5);
    });

    it('stamps a pre-K-P2 analysis that is current on every other axis, and re-analyses none', async () => {
      // The owner's backfill decision (2026-10-24).
      await seed('legacy-current', { analysisConfigHash: null });
      await seed('legacy-stale-text', {
        analysisConfigHash: null,
        analysisSourceTextHash: 'y'.repeat(64),
      });

      await service().generateMissing();

      const current = await db.proposition.findFirstOrThrow({
        where: { externalId: 'legacy-current' },
      });
      expect(current.analysisConfigHash).toBe(CONFIG);
      expect(current.analysisSummary).toBe('existing analysis');
      // A legacy row stale on another axis is not stamped — it re-analyses,
      // and the new analysis writes its own config hash.
      const stale = await db.proposition.findFirstOrThrow({
        where: { externalId: 'legacy-stale-text' },
      });
      expect(stale.analysisSummary).not.toBe('existing analysis');
      expect(stale.analysisConfigHash).toBe(CONFIG);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('still stamps, and re-analyses no legacy row, when the digest lookup failed', async () => {
      // Review finding: the stamp waited for the digest, so one failed
      // /api/tags call at boot would have re-analysed all 72 legacy rows.
      digest = undefined;
      await seed('legacy', { analysisConfigHash: null });

      await service().generateMissing();

      const row = await db.proposition.findFirstOrThrow({
        where: { externalId: 'legacy' },
      });
      expect(row.analysisConfigHash).toBe(CONFIG);
      expect(generate).not.toHaveBeenCalled();
    });

    it('does not regenerate the corpus when the model digest is unknown', async () => {
      digest = undefined;
      await seed('other-weights', { analysisLlmDigest: 'weights-b' });

      await service().generateMissing();

      expect(await analysed('other-weights')).toBe(false);
    });

    it('leaves a row current after a sync bumped updatedAt (the single-row path)', async () => {
      const row = await seed('touched');
      await db.proposition.update({
        where: { id: row.id },
        data: { summary: 'a sync rewrote this row' },
      });

      await expect(service().generate(row.id)).resolves.toBe(false);
      expect(generate).not.toHaveBeenCalled();
    });
  });
});

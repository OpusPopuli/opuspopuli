/**
 * Representatives Phase B against the real `postgres_test` database
 * (`docs/plans/representatives-phase-b.md`).
 *
 * The unit specs drive these paths against a mocked DbService, which cannot
 * see the failures that only a database shows:
 *
 *   - `representatives.source_version_id` — a relation `connect` that the
 *     migration's FK must accept, and `ON DELETE SET NULL` rather than a
 *     cascade that would delete a representative with its archived page
 *   - the vacant-seat decline — `bio_claims` cleared to SQL NULL
 *     (`Prisma.DbNull`, which a mock cannot tell from `JsonNull`) and the
 *     old bio's claims superseded in the `claims` table
 *   - legacy stamping — written through the real column mapping, after
 *     which the real query selects nothing
 *
 * LLM and prompt client are mocked (no Ollama in CI); the DB is real.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import { BioGeneratorService } from '../../../src/apps/region/src/domains/bio-generator.service';
import { RepresentativesSyncService } from '../../../src/apps/region/src/domains/representatives-sync.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const PROMPT_HASH = 'phase-b-it-prompt-hash';
const DIGEST = 'phase-b-it-digest';

const promptClient = () =>
  ({
    getPromptHash: jest.fn().mockResolvedValue(PROMPT_HASH),
    getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
      promptText: 'built prompt',
      promptHash: PROMPT_HASH,
      promptVersion: '1.0.0',
    }),
  }) as unknown as PromptClientService;

const llm = (text: string) =>
  ({
    getModelName: jest.fn().mockReturnValue('it-model'),
    getModelDigest: jest.fn().mockResolvedValue(DIGEST),
    generate: jest.fn().mockResolvedValue({ text }),
  }) as unknown as ILLMProvider & { generate: jest.Mock };

describe('representatives Phase B (real database)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectDatabase();
  });

  describe('the archived page a rep was extracted from', () => {
    const archive = async () => {
      const content = Buffer.from('<html>Assembly District 4</html>', 'utf8');
      return db.sourceVersion.create({
        data: {
          contentHash: createHash('sha256').update(content).digest('hex'),
          content,
          byteSize: content.length,
          sourceUrl: 'https://www.assembly.ca.gov/assemblymembers/04',
          fetchedAt: new Date('2026-10-27T00:00:00Z'),
          dataType: 'representatives',
        },
      });
    };

    /** The real sync's upsert, with a batch writer that runs each op. */
    const syncOne = (sourceVersionId?: string) =>
      new RepresentativesSyncService(db).sync(
        {
          fetchRepresentatives: async () => [
            {
              externalId: 'ca-assembly-4',
              name: 'Test Member',
              chamber: 'Assembly',
              district: '4',
              party: 'Democratic',
              ...(sourceVersionId && { sourceVersionId }),
            },
          ],
        },
        undefined,
        'california',
        {
          regionName: 'California',
          normalizeDistrict: false,
          bioNoisePatterns: [],
          bioTrimPatterns: [],
        },
        async (items, _find, map) => {
          await db.$transaction(map(items) as never);
          return { processed: items.length, created: 1, updated: 0 };
        },
        () => '4',
      );

    it('links the rep to its page, and survives the page being deleted', async () => {
      const page = await archive();

      await syncOne(page.id);
      const linked = await db.representative.findUnique({
        where: { externalId: 'ca-assembly-4' },
        select: { sourceVersionId: true },
      });
      expect(linked?.sourceVersionId).toBe(page.id);

      // ON DELETE SET NULL: the rep outlives its archived bytes.
      await db.sourceVersion.delete({ where: { id: page.id } });
      const after = await db.representative.findUnique({
        where: { externalId: 'ca-assembly-4' },
        select: { sourceVersionId: true },
      });
      expect(after).not.toBeNull();
      expect(after?.sourceVersionId).toBeNull();
    });

    it('writes the roster when a page id does not exist, rather than roll it back', async () => {
      await syncOne('no-such-source-version');

      const row = await db.representative.findUnique({
        where: { externalId: 'ca-assembly-4' },
        select: { sourceVersionId: true },
      });
      expect(row).not.toBeNull();
      expect(row?.sourceVersionId).toBeNull();
    });
  });

  describe('bios', () => {
    const create = (data: Record<string, unknown> = {}) =>
      db.representative.create({
        data: {
          externalId: 'ca-assembly-3',
          regionId: 'california',
          name: 'Member Vacant',
          chamber: 'Assembly',
          district: '3',
          party: 'Democratic',
          ...data,
        },
      });

    it('records a vacant seat’s decline, clears the last member’s bio and supersedes its claims', async () => {
      const rep = await create({
        bio: 'Jane Smith represented District 3.',
        bioSource: 'ai-generated',
        bioClaims: [{ sentence: 'Jane Smith represented District 3.' }],
        bioPromptHash: 'older-prompt',
        bioLlmDigest: DIGEST,
      });
      await db.claim.create({
        data: {
          subjectType: 'representative',
          subjectId: rep.id,
          text: 'Jane Smith represented District 3.',
        },
      });
      const service = new BioGeneratorService(
        undefined,
        promptClient(),
        llm('{ "bio": "", "wordCount": 0, "claims": [] }'),
        db,
      );

      await expect(service.generateOne(rep.id, 'California')).resolves.toBe(
        'skipped',
      );

      const row = await db.$queryRaw<
        {
          bio: string | null;
          bio_claims_is_sql_null: boolean;
          bio_prompt_hash: string;
        }[]
      >`SELECT bio, bio_claims IS NULL AS bio_claims_is_sql_null, bio_prompt_hash
          FROM representatives WHERE id = ${rep.id}`;
      expect(row[0].bio).toBeNull();
      expect(row[0].bio_claims_is_sql_null).toBe(true);
      expect(row[0].bio_prompt_hash).toBe(PROMPT_HASH);

      const current = await db.claim.count({
        where: {
          subjectType: 'representative',
          subjectId: rep.id,
          validUntil: null,
        },
      });
      expect(current).toBe(0);

      // And the seat is not asked about again.
      const { pending, current: n } = await service.selectStale(
        'California',
        'california',
      );
      expect([pending.length, n]).toEqual([0, 1]);
    });

    it('stamps a legacy bio through the real columns, after which nothing is stale', async () => {
      await create({
        name: 'Jane Smith',
        bio: 'Jane Smith represents District 3.',
        bioSource: 'ai-generated',
        bioPromptHash: PROMPT_HASH,
        bioLlmDigest: DIGEST,
      });
      const model = llm('unused');
      const service = new BioGeneratorService(
        undefined,
        promptClient(),
        model,
        db,
      );

      const first = await service.selectStale('California', 'california');
      expect([first.pending.length, first.current]).toEqual([0, 1]);
      const stamped = await db.representative.findUnique({
        where: { externalId: 'ca-assembly-3' },
        select: { bioSourceHash: true, bioConfigHash: true },
      });
      expect(stamped?.bioSourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stamped?.bioConfigHash).toMatch(/^[0-9a-f]{64}$/);

      const second = await service.selectStale('California', 'california');
      expect([second.pending.length, second.current]).toEqual([0, 1]);
      expect(model.generate).not.toHaveBeenCalled();
    });
  });
});

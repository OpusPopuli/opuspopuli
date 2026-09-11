/**
 * Integration test for AI-output provenance write-through (#1149).
 *
 * The unit specs assert each generator PASSES the provenance triple to its
 * persist call — against a mocked DbService. What they cannot catch is the
 * class of failure #1074 documented: schema and code disagreeing about
 * columns, invisible until a real row is written (its embedding columns
 * were vector(1536) in the DB while everything else assumed 384, and every
 * mocked test passed). This spec drives one generator end-to-end into the
 * real `postgres_test` database, so it exercises:
 *
 *   - the 20260911100000_generator_provenance migration actually applied
 *   - Prisma field ↔ column mapping for the new provenance columns
 *   - the acceptance criterion verbatim: a generated row carries non-null
 *     promptHash / promptVersion / llmModel
 *
 * BioGeneratorService is the representative generator (same LlmGeneratorBase
 * threading as the other four). LLM + prompt-client are mocked — no Ollama
 * in CI; the DB is real, per the integration-test convention.
 */

import type { DbService } from '@opuspopuli/relationaldb-provider';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import { BioGeneratorService } from '../../../src/apps/region/src/domains/bio-generator.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const EXTERNAL_ID = 'provenance-it-rep-1';

describe('generator provenance write-through (#1149)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await db.representative.create({
      data: {
        externalId: EXTERNAL_ID,
        regionId: 'california',
        name: 'Jane Smith',
        chamber: 'Senate',
        district: '5',
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectDatabase();
  });

  it('a generated bio row carries the non-null attribution triple', async () => {
    const promptClient = {
      getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
        promptText: 'built prompt',
        promptHash: 'sha256-of-the-published-prompt',
        promptVersion: '2.3.0',
      }),
    } as unknown as PromptClientService;

    const llm = {
      getModelName: jest.fn().mockReturnValue('qwen3.5-test:9b'),
      generate: jest.fn().mockResolvedValue({
        text: '{"bio":"Jane Smith represents District 5.","claims":[]}',
      }),
    } as unknown as ILLMProvider;

    const service = new BioGeneratorService(undefined, promptClient, llm, db);

    await service.enrichBios(
      [
        {
          externalId: EXTERNAL_ID,
          name: 'Jane Smith',
          chamber: 'Senate',
          district: '5',
          party: 'Democrat',
        },
      ],
      undefined,
    );

    const row = await db.representative.findUnique({
      where: { externalId: EXTERNAL_ID },
      select: {
        bio: true,
        bioSource: true,
        bioPromptHash: true,
        bioPromptVersion: true,
        bioLlmModel: true,
      },
    });

    expect(row?.bio).toBe('Jane Smith represents District 5.');
    expect(row?.bioSource).toBe('ai-generated');
    // The acceptance criterion, verbatim: non-null hash + model on the row.
    expect(row?.bioPromptHash).toBe('sha256-of-the-published-prompt');
    expect(row?.bioPromptVersion).toBe('2.3.0');
    expect(row?.bioLlmModel).toBe('qwen3.5-test:9b');
  });
});

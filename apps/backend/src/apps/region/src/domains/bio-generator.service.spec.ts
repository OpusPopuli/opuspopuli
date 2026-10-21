import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider, Representative } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { BioGeneratorService } from './bio-generator.service';
import { recordClaims } from './claim-recorder';

jest.mock('./claim-recorder', () => ({
  recordClaims: jest.fn().mockResolvedValue({ written: 0, byState: {} }),
}));

const recordClaimsMock = recordClaims as jest.MockedFunction<
  typeof recordClaims
>;

/**
 * Call `enrichBios` with the DB mock seeded from `reps`.
 *
 * Candidate selection moved to the database in #1394, so these tests have to
 * say what the DB holds. Seeding it from the array reproduces the old
 * contract exactly — the DB agrees with the scrape — which keeps every
 * parsing, persistence and attribution test below testing what it was written
 * to test. The cases where the two DISAGREE are what the change is actually
 * about, and they have their own describe block.
 */
async function enrichWith(
  built: {
    service: BioGeneratorService;
    db: DeepMocked<DbService>;
  },
  reps: Representative[],
  regionName?: string,
  regionId?: string,
): Promise<Representative[]> {
  // `DeepMocked` does not surface the mock type through Prisma's generated
  // delegate signature, so the cast is needed to set a return value.
  (built.db.representative.findMany as unknown as jest.Mock).mockResolvedValue(
    reps.filter((r) => !r.bio || r.bio.trim() === ''),
  );
  return built.service.enrichBios(reps, regionName, regionId);
}

describe('BioGeneratorService', () => {
  let service: BioGeneratorService;
  let promptClient: jest.Mocked<PromptClientService>;
  let llm: jest.Mocked<ILLMProvider>;
  let db: DeepMocked<DbService>;

  const baseRep = (
    overrides: Partial<Representative> = {},
  ): Representative => ({
    externalId: 'rep-1',
    name: 'Jane Smith',
    chamber: 'Senate',
    district: '5',
    party: 'Democrat',
    ...overrides,
  });

  async function buildService(
    withDeps: boolean,
    configValues: Record<string, string | undefined> = {},
  ): Promise<{
    service: BioGeneratorService;
    promptClient: jest.Mocked<PromptClientService>;
    llm: jest.Mocked<ILLMProvider>;
    db: DeepMocked<DbService>;
  }> {
    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    });

    const mockLlm = {
      getModelName: jest.fn().mockReturnValue('qwen-test:9b'),
      // #1281: the weights behind the tag, resolved by the provider.
      getModelDigest: jest.fn().mockResolvedValue('stub-digest'),
      generate: jest.fn(),
    } as unknown as jest.Mocked<ILLMProvider>;

    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const mockDb = createMock<DbService>();

    const providers = withDeps
      ? [
          BioGeneratorService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: PromptClientService, useValue: mockPromptClient },
          { provide: 'LLM_ANALYSIS_PROVIDER', useValue: mockLlm },
          { provide: DbService, useValue: mockDb },
        ]
      : [BioGeneratorService];

    const module: TestingModule = await Test.createTestingModule({
      providers,
    }).compile();

    return {
      service: module.get(BioGeneratorService),
      promptClient: mockPromptClient,
      llm: mockLlm,
      db: mockDb,
    };
  }

  describe('when dependencies are unavailable', () => {
    it('returns reps unmodified when prompt client and llm are missing', async () => {
      const built = await buildService(false);
      const reps = [baseRep({ bio: undefined })];

      const result = await built.service.enrichBios(reps, undefined, undefined);

      expect(result).toBe(reps);
      expect(result[0].bio).toBeUndefined();
      expect(result[0].bioSource).toBeUndefined();
    });
  });

  describe('when dependencies are available', () => {
    beforeEach(async () => {
      const built = await buildService(true);
      service = built.service;
      promptClient = built.promptClient;
      llm = built.llm;
      db = built.db;
    });

    it('generates bios only for reps with empty bio', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Jane Smith represents District 5 in the California Senate."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const reps = [
        baseRep({ externalId: 'r1', bio: 'Existing bio text.' }),
        baseRep({ externalId: 'r2', bio: '' }),
        baseRep({ externalId: 'r3' }),
      ];

      const result = await enrichWith({ service, db }, reps);

      expect(llm.generate).toHaveBeenCalledTimes(2);
      expect(result[0].bio).toBe('Existing bio text.');
      expect(result[0].bioSource).toBe('scraped');
      expect(result[1].bio).toBe(
        'Jane Smith represents District 5 in the California Senate.',
      );
      expect(result[1].bioSource).toBe('ai-generated');
      expect(result[2].bioSource).toBe('ai-generated');
    });

    it('persists each generated bio back to the DB by externalId (#881)', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Jane Smith represents District 5 in the California Senate."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const reps = [
        baseRep({ externalId: 'sen-5' }),
        baseRep({ externalId: 'sen-6', bio: '' }),
      ];

      await enrichWith({ service, db }, reps);

      // Regression for #828: the mutated bios must be WRITTEN BACK, not just
      // held in memory (the extraction dropped the persist, so a full reps
      // sync produced 0 persisted bios). Two reps needed a bio → two writes.
      expect(db.representative.update).toHaveBeenCalledTimes(2);
      expect(db.representative.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { externalId: 'sen-5' },
          data: expect.objectContaining({
            bio: 'Jane Smith represents District 5 in the California Senate.',
            bioSource: 'ai-generated',
            // #1149 — the attribution triple rides the same write.
            bioPromptHash: 'hash',
            bioPromptVersion: '1.0.0',
            bioLlmModel: 'qwen-test:9b',
            bioLlmDigest: 'stub-digest',
          }),
        }),
      );
    });

    it('does not write to the DB for reps that already have a bio (#881)', async () => {
      const reps = [baseRep({ externalId: 'has-bio', bio: 'Existing bio.' })];

      await enrichWith({ service, db }, reps);

      expect(llm.generate).not.toHaveBeenCalled();
      expect(db.representative.update).not.toHaveBeenCalled();
    });

    it('returns early when no reps need bios', async () => {
      const reps = [baseRep({ bio: 'Already has one.' })];

      const result = await enrichWith({ service, db }, reps);

      expect(llm.generate).not.toHaveBeenCalled();
      expect(result[0].bioSource).toBe('scraped');
    });

    it('strips markdown code fences from LLM response', async () => {
      llm.generate.mockResolvedValue({
        text: '```json\n{"bio": "Fenced bio."}\n```',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Fenced bio.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('skips rep when LLM returns empty bio', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": ""}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBeUndefined();
      expect(result[0].bioSource).toBeUndefined();
    });

    it('skips rep when LLM returns no recognizable bio field', async () => {
      llm.generate.mockResolvedValue({
        text: 'not json at all',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBeUndefined();
    });

    it('tier-2: salvages bio when JSON is truncated mid-claims', async () => {
      // Simulates real production failure: model hit maxTokens cap mid-way
      // through the claims array, leaving JSON unclosed.
      const truncatedResponse =
        '{\n  "bio": "Dawn Addis represents District 30 in the California State Assembly.",\n  "wordCount": 15,\n  "claims": [\n    {\n      "sentence": "Dawn Addis represents District';
      llm.generate.mockResolvedValue({
        text: truncatedResponse,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe(
        'Dawn Addis represents District 30 in the California State Assembly.',
      );
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('tier-2: salvages bio when JSON has malformed escaping later in document', async () => {
      const malformedResponse =
        '{"bio": "Valid bio text.", "claims": [{"sentence": "bad unescaped quote " breaks parser"}]}';
      llm.generate.mockResolvedValue({
        text: malformedResponse,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Valid bio text.');
    });

    it('tier-2: unescapes JSON escape sequences in bio string', async () => {
      const escapedBio =
        '{"bio": "Line one.\\nLine two with \\"quoted\\" text.", malformed rest of json';
      llm.generate.mockResolvedValue({
        text: escapedBio,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Line one.\nLine two with "quoted" text.');
    });

    it('tier-2: rejects bio substring too short to be a real bio', async () => {
      // Only 20 chars of bio before truncation — probably noise
      const tooShort = '{"bio": "Short';
      llm.generate.mockResolvedValue({
        text: tooShort,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBeUndefined();
    });

    it('continues on soft failure and processes remaining reps', async () => {
      llm.generate
        .mockRejectedValueOnce(new Error('LLM unavailable'))
        .mockResolvedValueOnce({
          text: '{"bio": "Bio for rep 2."}',
        } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const reps = [
        baseRep({ externalId: 'r1' }),
        baseRep({ externalId: 'r2' }),
      ];

      const result = await enrichWith({ service, db }, reps);

      expect(result[0].bio).toBeUndefined();
      expect(result[1].bio).toBe('Bio for rep 2.');
      expect(result[1].bioSource).toBe('ai-generated');
    });

    it('omits committees from prompt input and carries derived jurisdiction', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Bio."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      // Committees are covered by a separate committee-summary prompt;
      // including them here bloats output and correlates with JSON
      // truncation. Bio input is deliberately narrower now.
      const rep = baseRep({
        externalId: 'ca-senate-5',
        committees: [{ name: 'Budget', role: 'Chair' }, { name: 'Education' }],
      });

      await enrichWith({ service, db }, [rep], 'California');

      const firstCall = promptClient.getDocumentAnalysisPrompt.mock.calls[0][0];
      expect(firstCall.documentType).toBe('representative-bio');
      expect(firstCall.text).toContain('Name: Jane Smith');
      // Jurisdiction must be plumbed explicitly to prevent wrong-state
      // hallucination when Name+District isn't uniquely identifying.
      expect(firstCall.text).toContain('Jurisdiction: California State Senate');
      expect(firstCall.text).not.toContain('Committee Assignments');
      expect(firstCall.text).not.toContain('Chair: Budget');
    });

    it('uses county jurisdiction format for county region names', async () => {
      const rep = baseRep({
        bio: '',
        chamber: 'Board of Supervisors',
        externalId: 'california-sonoma-district-1',
      });

      await enrichWith({ service, db }, [rep], 'Sonoma County');

      const firstCall = promptClient.getDocumentAnalysisPrompt.mock.calls[0][0];
      expect(firstCall.text).toContain(
        'Jurisdiction: Sonoma County Board of Supervisors',
      );
      expect(firstCall.text).not.toContain('State Board');
    });

    it('preserves existing bioSource when already set', async () => {
      const reps = [baseRep({ bio: 'Has bio', bioSource: 'scraped' })];

      const result = await enrichWith({ service, db }, reps);

      expect(result[0].bioSource).toBe('scraped');
    });

    it('extracts bio from structured claim-tagged response', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({
          bio: 'Paragraph one.\n\nParagraph two.',
          wordCount: 42,
          claims: [
            {
              sentence: 'Paragraph one.',
              origin: 'source',
              sourceField: 'name',
              confidence: 'high',
            },
            {
              sentence: 'Paragraph two.',
              origin: 'training',
              sourceField: null,
              confidence: 'medium',
            },
          ],
        }),
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Paragraph one.\n\nParagraph two.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('tolerates leading prose before JSON', async () => {
      llm.generate.mockResolvedValue({
        text: 'Here is the biography JSON:\n\n{"bio": "Prose-wrapped bio."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Prose-wrapped bio.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('tolerates trailing prose after JSON', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Bio with trailing text."}\n\nLet me know if you need anything else.',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Bio with trailing text.');
    });

    it('handles nested braces inside string values', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Reference to {SB-42} passed."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Reference to {SB-42} passed.');
    });

    it('handles bio response with no claims array gracefully', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ bio: 'Just a bio.' }),
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await enrichWith({ service, db }, [baseRep()]);

      expect(result[0].bio).toBe('Just a bio.');
      expect(result[0].bioSource).toBe('ai-generated');
    });
  });

  describe('configuration', () => {
    it('uses default maxTokens=800 when env var is absent', async () => {
      const built = await buildService(true, {});
      (built.llm.generate as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ bio: 'Bio.' }),
      });

      await enrichWith(built, [baseRep()]);

      expect(built.llm.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTokens: 800 }),
      );
    });

    it('respects BIO_GENERATOR_MAX_TOKENS override', async () => {
      const built = await buildService(true, {
        BIO_GENERATOR_MAX_TOKENS: '500',
      });
      (built.llm.generate as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ bio: 'Bio.' }),
      });

      await enrichWith(built, [baseRep()]);

      expect(built.llm.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTokens: 500 }),
      );
    });

    it('falls back to default when BIO_GENERATOR_MAX_TOKENS is invalid', async () => {
      const built = await buildService(true, {
        BIO_GENERATOR_MAX_TOKENS: 'not-a-number',
      });
      (built.llm.generate as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ bio: 'Bio.' }),
      });

      await enrichWith(built, [baseRep()]);

      expect(built.llm.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTokens: 800 }),
      );
    });

    it('processes reps in parallel batches when concurrency > 1', async () => {
      const built = await buildService(true, {
        BIO_GENERATOR_CONCURRENCY: '3',
      });

      // Track the number of in-flight LLM calls to verify parallelism
      let inFlight = 0;
      let peakInFlight = 0;
      (built.llm.generate as jest.Mock).mockImplementation(async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { text: JSON.stringify({ bio: 'Bio.' }) };
      });

      const reps = Array.from({ length: 6 }, (_, i) =>
        baseRep({ externalId: `r${i}`, name: `Rep ${i}` }),
      );

      await enrichWith(built, reps);

      expect(peakInFlight).toBe(3);
      expect(built.llm.generate).toHaveBeenCalledTimes(6);
    });

    it('caps bios by BIO_GENERATOR_MAX_REPS when set', async () => {
      const built = await buildService(true, {
        BIO_GENERATOR_MAX_REPS: '2',
      });
      (built.llm.generate as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ bio: 'Bio.' }),
      });

      const reps = Array.from({ length: 5 }, (_, i) =>
        baseRep({ externalId: `r${i}`, name: `Rep ${i}` }),
      );

      const result = await enrichWith(built, reps);

      expect(built.llm.generate).toHaveBeenCalledTimes(2);
      expect(result[0].bioSource).toBe('ai-generated');
      expect(result[1].bioSource).toBe('ai-generated');
      expect(result[2].bioSource).toBeUndefined();
      expect(result[3].bioSource).toBeUndefined();
      expect(result[4].bioSource).toBeUndefined();
    });

    it('ignores BIO_GENERATOR_MAX_REPS when unset', async () => {
      const built = await buildService(true, {});
      (built.llm.generate as jest.Mock).mockResolvedValue({
        text: JSON.stringify({ bio: 'Bio.' }),
      });

      const reps = Array.from({ length: 3 }, (_, i) =>
        baseRep({ externalId: `r${i}` }),
      );

      await enrichWith(built, reps);

      expect(built.llm.generate).toHaveBeenCalledTimes(3);
    });

    it('isolates failures within a parallel batch', async () => {
      const built = await buildService(true, {
        BIO_GENERATOR_CONCURRENCY: '3',
      });

      (built.llm.generate as jest.Mock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ text: JSON.stringify({ bio: 'OK 2.' }) })
        .mockResolvedValueOnce({ text: JSON.stringify({ bio: 'OK 3.' }) });

      const reps = [
        baseRep({ externalId: 'r1', name: 'Rep 1' }),
        baseRep({ externalId: 'r2', name: 'Rep 2' }),
        baseRep({ externalId: 'r3', name: 'Rep 3' }),
      ];

      const result = await enrichWith(built, reps);

      expect(result[0].bio).toBeUndefined();
      expect(result[1].bio).toBe('OK 2.');
      expect(result[2].bio).toBe('OK 3.');
    });
  });

  describe('claim dual-write (#1293)', () => {
    const BIO_WITH_CLAIMS = JSON.stringify({
      bio: 'Jane Smith represents District 5. She is widely seen as a moderate.',
      claims: [
        {
          sentence: 'Jane Smith represents District 5.',
          origin: 'source',
          sourceField: 'district',
          confidence: 'high',
        },
        {
          sentence: 'She is widely seen as a moderate.',
          origin: 'training',
          sourceHint: 'press coverage of the 2022 election',
        },
      ],
    });

    beforeEach(async () => {
      // Own setup rather than leaning on a sibling describe's — without it
      // these pass only on state left behind by the previous block, which is
      // an accidental pass, not a guard.
      const built = await buildService(true);
      service = built.service;
      promptClient = built.promptClient;
      llm = built.llm;
      db = built.db;

      recordClaimsMock.mockClear();
      recordClaimsMock.mockResolvedValue({ written: 0, byState: {} });
      llm.generate.mockResolvedValue({
        text: BIO_WITH_CLAIMS,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);
      (db.representative.update as unknown as jest.Mock).mockResolvedValue({
        id: 'rep-row-1',
      });
    });

    it('mirrors bio claims into the evidence graph', async () => {
      await enrichWith({ service, db }, [baseRep({ externalId: 'sen-5' })]);

      // The call itself. Three dual-writes in this milestone typechecked,
      // passed their unit tests and wrote nothing.
      expect(recordClaimsMock).toHaveBeenCalledTimes(1);
      const input = recordClaimsMock.mock.calls[0][1];
      expect(input.subjectType).toBe('representative');
      // The row id from the write, not the external id — claims join on the
      // table's own key.
      expect(input.subjectId).toBe('rep-row-1');
      expect(input.claims).toHaveLength(2);
    });

    it('passes no source text, because bios cite fields rather than a document', async () => {
      await enrichWith({ service, db }, [baseRep({ externalId: 'sen-5' })]);

      const input = recordClaimsMock.mock.calls[0][1];
      expect(input.sourceText).toBeNull();
      expect(input.sourceTextHash).toBeNull();
    });

    it('keeps a training-origin claim uncited so it cannot read as sourced', async () => {
      await enrichWith({ service, db }, [baseRep({ externalId: 'sen-5' })]);

      const input = recordClaimsMock.mock.calls[0][1];
      const [sourced, recalled] = input.claims;

      // The distinction #1208 requires to survive: one offered a citation that
      // cannot be machine-checked, the other never offered one. `sourceHint`
      // is the model describing its own recollection, not a citation.
      expect(sourced.citation.citationHint).toBe('district');
      expect(recalled.citation.citationHint).toBeNull();
    });

    it('mirrors an empty claim list so superseded claims are cleared', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ bio: 'A short bio.', claims: [] }),
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await enrichWith({ service, db }, [baseRep({ externalId: 'sen-5' })]);

      // The blob writes `bioClaims: []`, so the mirror must too — otherwise
      // the relational model keeps asserting claims the blob no longer has.
      // Guarding on `?.length` skipped this case.
      expect(recordClaimsMock).toHaveBeenCalledTimes(1);
      expect(recordClaimsMock.mock.calls[0][1].claims).toEqual([]);
    });

    it('leaves claims alone when parsing salvaged only the bio text', async () => {
      // Tier-2 salvage: no `claims` key at all. The blob KEEPS its previous
      // claims here, so the mirror must leave the rows alone rather than
      // clearing them — the opposite of the empty-array case above.
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ bio: 'Salvaged bio only.' }),
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      await enrichWith({ service, db }, [baseRep({ externalId: 'sen-5' })]);

      expect(recordClaimsMock).not.toHaveBeenCalled();
    });

    it('keeps the bio when the dual-write fails', async () => {
      recordClaimsMock.mockRejectedValue(new Error('evidence table is gone'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const [rep] = await enrichWith({ service, db }, [
        baseRep({ externalId: 'sen-5' }),
      ]);

      // The bio is what citizens read; the mirror is read by nothing yet.
      expect(db.representative.update).toHaveBeenCalledTimes(1);
      expect(rep.bio).toContain('Jane Smith represents District 5.');

      // Asserting the blob was written is not enough here — it happens before
      // the mirror, so it survives either way. What the try/catch actually
      // buys is that a mirror failure is not reported as a failed generation:
      // without it the throw unwinds into the generator's own handler, which
      // logs a bio that in fact succeeded as having failed and counts it as
      // one. A misleading log about AI output is exactly the thing this
      // milestone is trying to stop producing.
      // The mirror failure is reported at `error` — the claims were not
      // written, and a systematic failure is otherwise invisible until
      // something reads the tables, which nothing does yet (#1296).
      expect(
        error.mock.calls
          .map(String)
          .some((m) => m.includes('Claim dual-write failed')),
      ).toBe(true);
      expect(
        warn.mock.calls
          .map(String)
          .some((m) => m.includes('Bio generation failed')),
      ).toBe(false);

      warn.mockRestore();
      error.mockRestore();
    });
  });

  describe('candidates come from the DB, not the scrape (#1394)', () => {
    beforeEach(async () => {
      const built = await buildService(true);
      service = built.service;
      llm = built.llm;
      db = built.db;
      llm.generate.mockResolvedValue({
        text: '{"bio": "Jane Smith represents District 5."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);
    });

    /** Seed the DB candidate query directly, independent of any array. */
    const seed = (rows: Partial<Representative>[]) =>
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue(
        rows,
      );

    it('does NOT regenerate a bio the DB already holds', async () => {
      // THE regression. The scraped rep arrives with no bio on every sync —
      // California's rosters carry one for 15 of 120 — so the old array
      // filter regenerated ~102 bios every run: 16m35s of model time, and 57
      // of them came back with different text. The DB is the authority on
      // what already exists.
      seed([]);

      const result = await service.enrichBios(
        [baseRep({ externalId: 'sen-5', bio: undefined })],
        'California',
        'california',
      );

      expect(llm.generate).not.toHaveBeenCalled();
      expect(db.representative.update).not.toHaveBeenCalled();
      expect(result[0].bio).toBeUndefined();
    });

    it('generates for a rep the scrape omitted entirely', async () => {
      // The roster returned 119 of 120 on two consecutive runs; Josh Becker
      // was absent both times and so was never a candidate under the old
      // filter. He is in the DB, which is where candidates now come from.
      seed([baseRep({ externalId: 'ca-senate-13', name: 'Josh Becker' })]);

      await service.enrichBios([], 'California', 'california');

      expect(llm.generate).toHaveBeenCalledTimes(1);
      expect(db.representative.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { externalId: 'ca-senate-13' } }),
      );
    });

    it('scopes the query to the region being synced', async () => {
      // Unscoped, a California sync would generate for another region's reps
      // and `deriveJurisdiction` would stamp them "California State …" —
      // the wrong-jurisdiction confabulation the prompt guards against.
      seed([]);

      await service.enrichBios([], 'California', 'california');

      expect(db.representative.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            regionId: 'california',
            OR: [{ bio: null }, { bio: '' }],
          }),
        }),
      );
    });

    it('queries every region when none is named', async () => {
      seed([]);

      await service.enrichBios([], undefined, undefined);

      const where = (db.representative.findMany as unknown as jest.Mock).mock
        .calls[0][0].where;
      expect(where).not.toHaveProperty('regionId');
    });

    it('orders candidates so a capped run is reproducible', async () => {
      // findMany guarantees no ordering, so an unordered cap would cover a
      // different arbitrary slice on every smoke run.
      seed([]);

      await service.enrichBios([], 'California', 'california');

      expect(db.representative.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { externalId: 'asc' } }),
      );
    });

    it('applies the cap to the DB candidates', async () => {
      seed([
        baseRep({ externalId: 'r1' }),
        baseRep({ externalId: 'r2' }),
        baseRep({ externalId: 'r3' }),
      ]);

      await service.enrichBios([], 'California', 'california', 2);

      expect(llm.generate).toHaveBeenCalledTimes(2);
    });

    it('copies the generated bio onto the scraped rep it matches', async () => {
      // Downstream phases hold `reps`, so what was generated has to be
      // visible there even though the generator persists it itself.
      seed([baseRep({ externalId: 'sen-5' })]);
      const reps = [baseRep({ externalId: 'sen-5', bio: undefined })];

      await service.enrichBios(reps, 'California', 'california');

      expect(reps[0].bio).toBe('Jane Smith represents District 5.');
      expect(reps[0].bioSource).toBe('ai-generated');
    });

    it('still generates when the candidate is absent from the array', async () => {
      // Nothing to copy onto, and that must not throw — this is the
      // roster-flake case the change exists to cover.
      seed([baseRep({ externalId: 'not-in-scrape' })]);
      const reps = [baseRep({ externalId: 'sen-5', bio: 'Scraped bio.' })];

      await expect(
        service.enrichBios(reps, 'California', 'california'),
      ).resolves.toBeDefined();

      expect(db.representative.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { externalId: 'not-in-scrape' } }),
      );
      expect(reps[0].bio).toBe('Scraped bio.');
    });

    it('warns and selects nothing when no DB is bound', async () => {
      // Built directly: `buildService(false)` omits the prompt client and LLM
      // too, so `enrichBios` returned at its first guard and `findCandidates`
      // was never reached — the `!this.db` branch this test names was 0%
      // covered, and deleting it passed. And `expect(result).toBe(reps)` is
      // true on every path, since `enrichBios` always returns `reps`.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const mockPromptClient = createMock<PromptClientService>();
      const mockLlm = {
        getModelName: jest.fn().mockReturnValue('m'),
        getModelDigest: jest.fn().mockResolvedValue('d'),
        generate: jest.fn(),
      } as unknown as jest.Mocked<ILLMProvider>;
      const service = new BioGeneratorService(
        undefined,
        mockPromptClient,
        mockLlm,
        undefined,
      );

      await service.enrichBios(
        [baseRep({ bio: undefined })],
        'California',
        'california',
      );

      expect(mockLlm.generate).not.toHaveBeenCalled();
      expect(
        warn.mock.calls.map(String).some((m) => m.includes('No DbService')),
      ).toBe(true);
      warn.mockRestore();
    });
  });

  describe('prompt input omits fields the source does not have (#1381)', () => {
    beforeEach(async () => {
      const built = await buildService(true);
      service = built.service;
      promptClient = built.promptClient;
      llm = built.llm;
      db = built.db;
      llm.generate.mockResolvedValue({
        text: '{"bio": "Hermosillo represents District 1 on the Sonoma County Board of Supervisors."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);
    });

    const promptText = () =>
      promptClient.getDocumentAnalysisPrompt.mock.calls[0][0].text;

    it('omits Party entirely for a non-partisan office', async () => {
      // All five Sonoma supervisors have party = NULL; county offices in
      // California are non-partisan. Interpolation rendered that as the
      // literal line "Party: null".
      const rep = {
        externalId: 'sonoma-district-1',
        name: 'Rebecca Hermosillo',
        chamber: 'Board of Supervisors',
        district: '1',
        party: null,
      } as unknown as Representative;
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue([
        rep,
      ]);

      await service.enrichBios([], 'Sonoma County', 'california-sonoma');

      expect(promptText()).not.toContain('null');
      expect(promptText()).not.toContain('Party:');
      expect(promptText()).toContain('Name: Rebecca Hermosillo');
      // A county chamber is not given a "State" infix.
      expect(promptText()).toContain(
        'Jurisdiction: Sonoma County Board of Supervisors',
      );
      expect(promptText()).toContain('District: 1');
    });

    it('omits a blank field as well as a missing one', async () => {
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue([
        baseRep({ externalId: 'r1', party: '   ', district: '' }),
      ]);

      await service.enrichBios([], 'California', 'california');

      expect(promptText()).not.toContain('Party:');
      expect(promptText()).not.toContain('District:');
    });

    it('keeps every field that does have a value', async () => {
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue([
        baseRep({ externalId: 'r1' }),
      ]);

      await service.enrichBios([], 'California', 'california');

      expect(promptText()).toBe(
        [
          'Name: Jane Smith',
          'Jurisdiction: California State Senate',
          'District: 5',
          'Party: Democrat',
        ].join('\n'),
      );
    });
  });

  describe('the source-grounding guard is wired in (#1381)', () => {
    beforeEach(async () => {
      const built = await buildService(true);
      service = built.service;
      llm = built.llm;
      db = built.db;
    });

    const seed = (rows: Partial<Representative>[]) =>
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue(
        rows,
      );

    const generated = (text: string) =>
      llm.generate.mockResolvedValue({ text } as Awaited<
        ReturnType<ILLMProvider['generate']>
      >);

    it('strips the unsupported sentence before the bio is persisted', async () => {
      // Every other fixture in this file is year-free, so deleting the
      // `enforceSourceYears` call passed all of them. This is the test that
      // fails if the guard stops being called.
      seed([baseRep({ externalId: 'sen-5' })]);
      generated(
        JSON.stringify({
          bio: 'Smith represents District 5. She was first elected in 2022.',
          wordCount: 11,
          claims: [
            { sentence: 'Smith represents District 5.', origin: 'source' },
            { sentence: 'She was first elected in 2022.', origin: 'source' },
          ],
        }),
      );

      await service.enrichBios([], 'California', 'california');

      const { data } = (db.representative.update as unknown as jest.Mock).mock
        .calls[0][0];
      expect(data.bio).toBe('Smith represents District 5.');
      // The claim attesting to the removed sentence goes with it, or
      // `bio_claims` attests to text that is not in the bio — the #1391
      // failure class.
      expect(data.bioClaims).toEqual([
        { sentence: 'Smith represents District 5.', origin: 'source' },
      ]);
      // Recounted, not the model's figure for the text before the guard ran.
      expect(data.wordCount ?? undefined).toBeUndefined();
    });

    it('stores no bio when every sentence is unsupported', async () => {
      seed([baseRep({ externalId: 'sen-5' })]);
      generated(
        JSON.stringify({
          bio: 'She was first elected in 2022. She is serving her first term.',
          claims: [],
        }),
      );

      await service.enrichBios([], 'California', 'california');

      // A bio of nothing is not stored at all; the rep stays a candidate.
      expect(db.representative.update).not.toHaveBeenCalled();
    });

    it('survives a claim element that carries no sentence', async () => {
      // `parseBioFromResponse` validates only that `claims` is an array, so a
      // malformed element reached `normalise(claim.sentence)` and threw —
      // discarding a bio whose other sentence was perfectly good.
      seed([baseRep({ externalId: 'sen-5' })]);
      generated(
        JSON.stringify({
          bio: 'Smith represents District 5. She was first elected in 2022.',
          claims: [
            { sentence: 'Smith represents District 5.', origin: 'source' },
            { origin: 'training', text: 'elected 2022' },
          ],
        }),
      );

      await service.enrichBios([], 'California', 'california');

      const { data } = (db.representative.update as unknown as jest.Mock).mock
        .calls[0][0];
      expect(data.bio).toBe('Smith represents District 5.');
    });

    it('keeps a year the source data supports', async () => {
      // The guard must not fire on grounded text. `baseRep` has no year, so
      // the source is widened here the way a scraped bio would widen it.
      seed([baseRep({ externalId: 'sen-5', party: 'Democrat, elected 2022' })]);
      generated(
        JSON.stringify({
          bio: 'Smith represents District 5. She was elected in 2022.',
          claims: [],
        }),
      );

      await service.enrichBios([], 'California', 'california');

      const { data } = (db.representative.update as unknown as jest.Mock).mock
        .calls[0][0];
      expect(data.bio).toBe(
        'Smith represents District 5. She was elected in 2022.',
      );
    });
  });

  describe("candidate selection is the QUERY's, not the test helper's", () => {
    it('does not generate for a rep the DB says already has a bio', async () => {
      // `enrichWith` seeds the DB mock from the array, which reproduces the
      // old contract and so cannot prove the `where` clause does the
      // filtering. Seeding the query directly can.
      const built = await buildService(true);
      (
        built.db.representative.findMany as unknown as jest.Mock
      ).mockResolvedValue([]);

      await built.service.enrichBios(
        [baseRep({ externalId: 'sen-5', bio: undefined })],
        'California',
        'california',
      );

      expect(built.llm.generate).not.toHaveBeenCalled();
    });
  });

  describe('county jurisdiction and sentinel fields (#1381)', () => {
    beforeEach(async () => {
      const built = await buildService(true);
      service = built.service;
      promptClient = built.promptClient;
      llm = built.llm;
      db = built.db;
      llm.generate.mockResolvedValue({
        text: '{"bio": "Hopkins represents District 5 on the Sonoma County Board of Supervisors."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);
    });

    const seedRegionsAndRep = (
      rep: Partial<Representative>,
      plugins: { name: string; displayName: string }[] = [
        { name: 'california', displayName: 'California' },
        { name: 'california-sonoma', displayName: 'Sonoma County' },
      ],
    ) => {
      (db.regionPlugin.findMany as unknown as jest.Mock).mockResolvedValue(
        plugins,
      );
      (db.representative.findMany as unknown as jest.Mock).mockResolvedValue([
        rep,
      ]);
    };

    const promptText = () =>
      promptClient.getDocumentAnalysisPrompt.mock.calls[0][0].text;

    it('names the COUNTY, not the parent region, as the jurisdiction', async () => {
      // `getPluginRegionName()` returns "California" for a county sync, so
      // the county test failed and five Sonoma supervisors were told they
      // sit on the "California State Board of Supervisors" — a body that
      // does not exist. The rep's own region id is the authority.
      seedRegionsAndRep({
        externalId: 'sonoma-district-5',
        name: 'Lynda Hopkins',
        chamber: 'Board of Supervisors',
        district: '5',
        regionId: 'california-sonoma',
      } as Representative);

      await service.enrichBios([], 'California', 'california-sonoma');

      expect(promptText()).toContain(
        'Jurisdiction: Sonoma County Board of Supervisors',
      );
      expect(promptText()).not.toContain('California State');
    });

    it('still inserts "State" for a state-level chamber', async () => {
      seedRegionsAndRep({
        externalId: 'ca-senate-11',
        name: 'Scott Wiener',
        chamber: 'Senate',
        district: '11',
        party: 'Democrat',
        regionId: 'california',
      } as Representative);

      await service.enrichBios([], 'California', 'california');

      expect(promptText()).toContain('Jurisdiction: California State Senate');
    });

    it('omits a party the mapper defaulted to "Unknown"', async () => {
      // `domain-mapper.service.ts` defaults an unscraped party to the string
      // "Unknown". Measured on the Sonoma supervisors, who are
      // non-partisan, the bios came back "She is listed as Unknown party."
      seedRegionsAndRep({
        externalId: 'sonoma-district-5',
        name: 'Lynda Hopkins',
        chamber: 'Board of Supervisors',
        district: '5',
        party: 'Unknown',
        regionId: 'california-sonoma',
      } as Representative);

      await service.enrichBios([], 'California', 'california-sonoma');

      expect(promptText()).not.toContain('Party:');
      expect(promptText()).not.toMatch(/unknown/i);
    });

    it.each(['n/a', 'None', 'null', 'UNKNOWN', '  unknown  '])(
      'omits the sentinel party %j',
      async (party) => {
        seedRegionsAndRep({
          externalId: 'r1',
          name: 'Jane Smith',
          chamber: 'Senate',
          district: '5',
          party,
          regionId: 'california',
        } as Representative);

        await service.enrichBios([], 'California', 'california');

        expect(promptText()).not.toContain('Party:');
      },
    );

    it('keeps a real party', async () => {
      seedRegionsAndRep({
        externalId: 'r1',
        name: 'Jane Smith',
        chamber: 'Senate',
        district: '5',
        party: 'Republican',
        regionId: 'california',
      } as Representative);

      await service.enrichBios([], 'California', 'california');

      expect(promptText()).toContain('Party: Republican');
    });

    it('falls back to the active region name when the plugin is unknown', async () => {
      seedRegionsAndRep(
        {
          externalId: 'r1',
          name: 'Jane Smith',
          chamber: 'Senate',
          district: '5',
          regionId: 'not-in-the-table',
        } as Representative,
        [],
      );

      await service.enrichBios([], 'California', 'california');

      expect(promptText()).toContain('Jurisdiction: California State Senate');
    });
  });
});

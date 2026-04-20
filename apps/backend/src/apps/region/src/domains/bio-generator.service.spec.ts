import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider, Representative } from '@opuspopuli/common';

import { BioGeneratorService } from './bio-generator.service';

describe('BioGeneratorService', () => {
  let service: BioGeneratorService;
  let promptClient: jest.Mocked<PromptClientService>;
  let llm: jest.Mocked<ILLMProvider>;

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
  }> {
    const mockPromptClient = createMock<PromptClientService>();
    mockPromptClient.getDocumentAnalysisPrompt.mockResolvedValue({
      promptText: 'built prompt',
      promptHash: 'hash',
      promptVersion: '1.0.0',
    });

    const mockLlm = {
      generate: jest.fn(),
    } as unknown as jest.Mocked<ILLMProvider>;

    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const providers = withDeps
      ? [
          BioGeneratorService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: PromptClientService, useValue: mockPromptClient },
          { provide: 'LLM_PROVIDER', useValue: mockLlm },
        ]
      : [BioGeneratorService];

    const module: TestingModule = await Test.createTestingModule({
      providers,
    }).compile();

    return {
      service: module.get(BioGeneratorService),
      promptClient: mockPromptClient,
      llm: mockLlm,
    };
  }

  describe('when dependencies are unavailable', () => {
    it('returns reps unmodified when prompt client and llm are missing', async () => {
      const built = await buildService(false);
      const reps = [baseRep({ bio: undefined })];

      const result = await built.service.enrichBios(reps);

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

      const result = await service.enrichBios(reps);

      expect(llm.generate).toHaveBeenCalledTimes(2);
      expect(result[0].bio).toBe('Existing bio text.');
      expect(result[0].bioSource).toBe('scraped');
      expect(result[1].bio).toBe(
        'Jane Smith represents District 5 in the California Senate.',
      );
      expect(result[1].bioSource).toBe('ai-generated');
      expect(result[2].bioSource).toBe('ai-generated');
    });

    it('returns early when no reps need bios', async () => {
      const reps = [baseRep({ bio: 'Already has one.' })];

      const result = await service.enrichBios(reps);

      expect(llm.generate).not.toHaveBeenCalled();
      expect(result[0].bioSource).toBe('scraped');
    });

    it('strips markdown code fences from LLM response', async () => {
      llm.generate.mockResolvedValue({
        text: '```json\n{"bio": "Fenced bio."}\n```',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Fenced bio.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('skips rep when LLM returns empty bio', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": ""}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBeUndefined();
      expect(result[0].bioSource).toBeUndefined();
    });

    it('skips rep when LLM returns no recognizable bio field', async () => {
      llm.generate.mockResolvedValue({
        text: 'not json at all',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

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

      const result = await service.enrichBios([baseRep()]);

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

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Valid bio text.');
    });

    it('tier-2: unescapes JSON escape sequences in bio string', async () => {
      const escapedBio =
        '{"bio": "Line one.\\nLine two with \\"quoted\\" text.", malformed rest of json';
      llm.generate.mockResolvedValue({
        text: escapedBio,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Line one.\nLine two with "quoted" text.');
    });

    it('tier-2: rejects bio substring too short to be a real bio', async () => {
      // Only 20 chars of bio before truncation — probably noise
      const tooShort = '{"bio": "Short';
      llm.generate.mockResolvedValue({
        text: tooShort,
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

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

      const result = await service.enrichBios(reps);

      expect(result[0].bio).toBeUndefined();
      expect(result[1].bio).toBe('Bio for rep 2.');
      expect(result[1].bioSource).toBe('ai-generated');
    });

    it('includes committee assignments in the prompt data', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Bio."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const rep = baseRep({
        committees: [{ name: 'Budget', role: 'Chair' }, { name: 'Education' }],
      });

      await service.enrichBios([rep]);

      const firstCall = promptClient.getDocumentAnalysisPrompt.mock.calls[0][0];
      expect(firstCall.documentType).toBe('representative-bio');
      expect(firstCall.text).toContain('Name: Jane Smith');
      expect(firstCall.text).toContain('Chair: Budget');
      expect(firstCall.text).toContain('Education');
    });

    it('preserves existing bioSource when already set', async () => {
      const reps = [baseRep({ bio: 'Has bio', bioSource: 'scraped' })];

      const result = await service.enrichBios(reps);

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

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Paragraph one.\n\nParagraph two.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('tolerates leading prose before JSON', async () => {
      llm.generate.mockResolvedValue({
        text: 'Here is the biography JSON:\n\n{"bio": "Prose-wrapped bio."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Prose-wrapped bio.');
      expect(result[0].bioSource).toBe('ai-generated');
    });

    it('tolerates trailing prose after JSON', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Bio with trailing text."}\n\nLet me know if you need anything else.',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Bio with trailing text.');
    });

    it('handles nested braces inside string values', async () => {
      llm.generate.mockResolvedValue({
        text: '{"bio": "Reference to {SB-42} passed."}',
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

      expect(result[0].bio).toBe('Reference to {SB-42} passed.');
    });

    it('handles bio response with no claims array gracefully', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ bio: 'Just a bio.' }),
      } as Awaited<ReturnType<ILLMProvider['generate']>>);

      const result = await service.enrichBios([baseRep()]);

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

      await built.service.enrichBios([baseRep()]);

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

      await built.service.enrichBios([baseRep()]);

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

      await built.service.enrichBios([baseRep()]);

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

      await built.service.enrichBios(reps);

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

      const result = await built.service.enrichBios(reps);

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

      await built.service.enrichBios(reps);

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

      const result = await built.service.enrichBios(reps);

      expect(result[0].bio).toBeUndefined();
      expect(result[1].bio).toBe('OK 2.');
      expect(result[2].bio).toBe('OK 3.');
    });
  });
});

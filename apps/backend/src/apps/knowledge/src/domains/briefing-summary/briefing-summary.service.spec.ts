import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { createMockDbClient } from '@opuspopuli/relationaldb-provider/testing';
import type { MockDbClient } from '@opuspopuli/relationaldb-provider/testing';
import {
  PromptClientService,
  type PromptServiceResponse,
} from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/llm-provider';

import {
  BriefingSummaryService,
  type BriefingSummaryContext,
} from './briefing-summary.service';
import { BriefingSummaryValidatorService } from './briefing-summary-validator.service';

const ctx: BriefingSummaryContext = {
  language: 'en',
  firstName: 'Rodney',
  billCount: 5,
  repCount: 7,
  committeeCount: 5,
  propositionCount: 1,
  urgentBillCount: 3,
  topBillTopAxis: 'directMaterial',
};

const VALID_PARAGRAPH =
  'Welcome back, Rodney. The briefing below holds 5 bills, 7 representatives, 5 committees, and 1 proposition matched to your signals — 3 of the bills have a hearing, vote, or comment window opening within the next 30 days, with the top one affecting money and services directly.';

function makePromptResponse(
  overrides: Partial<PromptServiceResponse> = {},
): PromptServiceResponse {
  return {
    promptText: 'rendered prompt',
    promptHash: 'hash-v1',
    promptVersion: 'v1',
    ...overrides,
  };
}

describe('BriefingSummaryService', () => {
  let service: BriefingSummaryService;
  let db: MockDbClient;
  let promptClient: jest.Mocked<PromptClientService>;
  let llm: jest.Mocked<ILLMProvider>;
  let validator: BriefingSummaryValidatorService;

  beforeEach(async () => {
    db = createMockDbClient();
    promptClient = createMock<PromptClientService>();
    llm = createMock<ILLMProvider>();
    validator = new BriefingSummaryValidatorService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingSummaryService,
        { provide: DbService, useValue: db },
        { provide: PromptClientService, useValue: promptClient },
        { provide: BriefingSummaryValidatorService, useValue: validator },
        { provide: 'LLM_PROVIDER', useValue: llm },
      ],
    }).compile();

    service = module.get(BriefingSummaryService);

    // Default prompt-service response (template-hash probe + render
    // both succeed). Individual tests override as needed.
    promptClient.getBriefingSummaryPrompt.mockResolvedValue(
      makePromptResponse(),
    );
  });

  describe('cache hit', () => {
    it('returns cached text and never calls the LLM when cache is fresh + hash matches', async () => {
      db.briefingSummaryCache.findUnique.mockResolvedValue({
        id: 'cache-1',
        userId: 'u-1',
        language: 'en',
        summaryText: 'cached paragraph from a prior visit',
        templateHash: 'hash-v1',
        variantId: null,
        tokensOut: 1234,
        computedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe('cached paragraph from a prior visit');
      expect(llm.generate).not.toHaveBeenCalled();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('treats expired rows as miss and regenerates', async () => {
      db.briefingSummaryCache.findUnique.mockResolvedValue({
        id: 'cache-1',
        userId: 'u-1',
        language: 'en',
        summaryText: 'stale paragraph',
        templateHash: 'hash-v1',
        variantId: null,
        tokensOut: 0,
        computedAt: new Date(),
        expiresAt: new Date(Date.now() - 1_000), // expired
      });
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 100,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe(VALID_PARAGRAPH);
      expect(llm.generate).toHaveBeenCalledTimes(1);
      expect(db.briefingSummaryCache.upsert).toHaveBeenCalledTimes(1);
    });

    it('treats template-hash mismatch as miss and regenerates (upstream rephrase)', async () => {
      // Prompt-service returns hash-v2 for the probe + the real render;
      // cache row was written with hash-v1 → invalidate.
      promptClient.getBriefingSummaryPrompt.mockResolvedValue(
        makePromptResponse({ promptHash: 'hash-v2' }),
      );
      db.briefingSummaryCache.findUnique.mockResolvedValue({
        id: 'cache-1',
        userId: 'u-1',
        language: 'en',
        summaryText: 'paragraph from when template was v1',
        templateHash: 'hash-v1',
        variantId: null,
        tokensOut: 0,
        computedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 100,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe(VALID_PARAGRAPH);
      expect(llm.generate).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache miss → generate', () => {
    beforeEach(() => {
      db.briefingSummaryCache.findUnique.mockResolvedValue(null);
    });

    it('calls LLM, validates, and writes the cache on the happy path', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 137,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe(VALID_PARAGRAPH);
      expect(db.briefingSummaryCache.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = db.briefingSummaryCache.upsert.mock.calls[0][0];
      expect(upsertCall.create.summaryText).toBe(VALID_PARAGRAPH);
      expect(upsertCall.create.templateHash).toBe('hash-v1');
      expect(upsertCall.create.tokensOut).toBe(137);
    });

    it('strips ```json fences from LLM output before parsing', async () => {
      llm.generate.mockResolvedValue({
        text:
          '```json\n' +
          JSON.stringify({ paragraph: VALID_PARAGRAPH }) +
          '\n```',
        tokensUsed: 100,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe(VALID_PARAGRAPH);
      expect(db.briefingSummaryCache.upsert).toHaveBeenCalledTimes(1);
    });

    it('returns null and skips the cache write when LLM emits { skip: true }', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ skip: true, reason: 'all counts zero' }),
        tokensUsed: 10,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBeNull();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('returns null and skips the cache write when LLM emits malformed JSON', async () => {
      llm.generate.mockResolvedValue({
        text: 'not even close to JSON',
        tokensUsed: 5,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBeNull();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('returns null and skips the cache write when the validator rejects the paragraph', async () => {
      // Persuasive language — caught by BriefingSummaryValidatorService.
      const persuasive = `${VALID_PARAGRAPH} You should call your rep before Friday.`;
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: persuasive }),
        tokensUsed: 100,
      });

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBeNull();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('returns null and skips the cache write when the LLM throws', async () => {
      llm.generate.mockRejectedValue(new Error('Ollama unreachable'));

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBeNull();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('returns null when the prompt-service render call throws', async () => {
      // Both the probe AND the render call throw — service treats both
      // as `llm_failed`.
      promptClient.getBriefingSummaryPrompt.mockRejectedValue(
        new Error('prompt-service 503'),
      );

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBeNull();
      expect(llm.generate).not.toHaveBeenCalled();
      expect(db.briefingSummaryCache.upsert).not.toHaveBeenCalled();
    });

    it('still surfaces the paragraph when the cache write fails (DB hiccup)', async () => {
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 100,
      });
      db.briefingSummaryCache.upsert.mockRejectedValue(
        new Error('connection refused'),
      );

      const result = await service.getOrGenerate('u-1', ctx);

      expect(result).toBe(VALID_PARAGRAPH);
    });
  });

  describe('concurrent in-flight coalescing', () => {
    it('only fires one LLM call when two requests race for the same (user, language)', async () => {
      db.briefingSummaryCache.findUnique.mockResolvedValue(null);
      // Hold the LLM call open so both peers enter the in-flight map.
      let resolveLlm: (value: {
        text: string;
        tokensUsed: number;
      }) => void = () => {};
      const llmPromise = new Promise<{ text: string; tokensUsed: number }>(
        (resolve) => {
          resolveLlm = resolve;
        },
      );
      llm.generate.mockReturnValue(llmPromise);

      const first = service.getOrGenerate('u-1', ctx);
      const second = service.getOrGenerate('u-1', ctx);

      // Resolve the held LLM call; both callers should now wake up.
      resolveLlm({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 100,
      });
      const [r1, r2] = await Promise.all([first, second]);

      expect(r1).toBe(VALID_PARAGRAPH);
      expect(r2).toBe(VALID_PARAGRAPH);
      expect(llm.generate).toHaveBeenCalledTimes(1);
      // Only one cache write because only one generate ran.
      expect(db.briefingSummaryCache.upsert).toHaveBeenCalledTimes(1);
    });

    it('re-runs after the first call completes (not stuck after coalesce)', async () => {
      db.briefingSummaryCache.findUnique.mockResolvedValue(null);
      llm.generate.mockResolvedValue({
        text: JSON.stringify({ paragraph: VALID_PARAGRAPH }),
        tokensUsed: 100,
      });

      await service.getOrGenerate('u-1', ctx);
      // Second call — in-flight map cleared after first finished; this
      // should fire a fresh LLM call (no cache hit because we didn't
      // wire up the mock to return the just-upserted row).
      await service.getOrGenerate('u-1', ctx);

      expect(llm.generate).toHaveBeenCalledTimes(2);
    });
  });
});

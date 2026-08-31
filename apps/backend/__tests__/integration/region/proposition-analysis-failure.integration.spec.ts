/**
 * The persisted failure state for proposition analysis (#1085), against a real
 * Postgres.
 *
 * Four measures carry no analysis and never will under the current code. They
 * render empty to every reader, and nothing reported it: the reason went to
 * `logger.debug` — off in production — and one refusal path wrote nothing at
 * any level. `analysis_failure_reason` makes "we could not analyse this" a
 * state the row holds rather than an absence a reader has to infer.
 *
 * The unit spec covers which reason each refusal produces. What can only be
 * checked against a real database is the pair of writes actually landing and,
 * more importantly, the failure being **cleared** when a measure later
 * succeeds — a stale verdict outliving the problem it describes would be its
 * own silent wrongness.
 *
 * The LLM and prompt-client are stubbed. The assertion is about persistence,
 * not model output.
 */
import { ConfigService } from '@nestjs/config';
import type { ILLMProvider } from '@opuspopuli/common';
import type { PromptClientService } from '@opuspopuli/prompt-client';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';
import { PropositionAnalysisService } from '../../../src/apps/region/src/domains/proposition-analysis.service';

const EXTERNAL_ID = 'TEST-1085-A';

const VALID_ANALYSIS = JSON.stringify({
  analysisSummary: 'Requires annual inspection of every streetlight.',
  keyProvisions: ['Annual inspection'],
  fiscalImpact: 'Funded from existing franchise revenue.',
  yesOutcome: 'A yes vote requires inspections.',
  noOutcome: 'A no vote keeps current practice.',
  existingVsProposed: { current: 'No schedule', proposed: 'Annual' },
  analysisSections: [],
  analysisClaims: [],
});

const configStub = {
  get: () => undefined,
} as unknown as ConfigService;

const promptClientStub = {
  getDocumentAnalysisPrompt: jest.fn().mockResolvedValue({
    promptText: 'rendered proposition prompt',
    promptHash: 'h'.repeat(64),
    promptVersion: '1.0.0',
  }),
  getPromptHash: jest.fn().mockResolvedValue('h'.repeat(64)),
} as unknown as PromptClientService;

function llmReturning(text: string, finishReason?: 'stop' | 'length') {
  return {
    generate: jest.fn(async () => ({ text, finishReason })),
  } as unknown as ILLMProvider;
}

async function seedMeasure() {
  const db = await getDbService();
  return db.proposition.create({
    data: {
      externalId: EXTERNAL_ID,
      title:
        'REQUIRES MUNICIPAL STREETLIGHT MAINTENANCE. INITIATIVE ORDINANCE.',
      summary: 'Requires annual inspection and repair of streetlights.',
      status: 'circulating',
      fullText: 'SECTION 1. The city shall inspect every streetlight annually.',
    },
  });
}

describe('Proposition analysis failure state (#1085, real DB)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('records the reason on the row when the output is truncated', async () => {
    const db = await getDbService();
    const measure = await seedMeasure();
    const service = new PropositionAnalysisService(
      configStub,
      promptClientStub,
      llmReturning('{"analysisSummary": "cut off mid-', 'length'),
      db,
    );

    await expect(service.generate(measure.id)).resolves.toBe(false);

    const row = await db.proposition.findUnique({
      where: { id: measure.id },
      select: {
        analysisFailureReason: true,
        analysisFailedAt: true,
        analysisSummary: true,
        analysisGeneratedAt: true,
      },
    });
    expect(row?.analysisFailureReason).toBe('truncated');
    expect(row?.analysisFailedAt).toBeInstanceOf(Date);
    // A refusal must not leave a half-written analysis behind.
    expect(row?.analysisSummary).toBeNull();
    expect(row?.analysisGeneratedAt).toBeNull();
  });

  it('clears the recorded failure once the measure analyses', async () => {
    const db = await getDbService();
    const measure = await seedMeasure();

    await new PropositionAnalysisService(
      configStub,
      promptClientStub,
      llmReturning('not json at all'),
      db,
    ).generate(measure.id);

    const failed = await db.proposition.findUnique({
      where: { id: measure.id },
      select: { analysisFailureReason: true },
    });
    expect(failed?.analysisFailureReason).toBe('no_json');

    // The same measure, now analysable — a longer output budget, a fixed
    // prompt, anything. The verdict must not outlive the problem.
    await new PropositionAnalysisService(
      configStub,
      promptClientStub,
      llmReturning(VALID_ANALYSIS, 'stop'),
      db,
    ).generate(measure.id, true);

    const recovered = await db.proposition.findUnique({
      where: { id: measure.id },
      select: {
        analysisFailureReason: true,
        analysisFailedAt: true,
        analysisSummary: true,
      },
    });
    expect(recovered?.analysisFailureReason).toBeNull();
    expect(recovered?.analysisFailedAt).toBeNull();
    expect(recovered?.analysisSummary).toContain('streetlight');
  });
});

import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';
import type { CommitteeAssignment, ILLMProvider } from '@opuspopuli/common';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';

/**
 * The split (#1393): roles are rendered from structured data, policy areas
 * come from the model, and the model is never shown a role.
 *
 * Driven through `generateMissingSummaries` so the prompt input and the
 * persisted text are the real ones — the thing under test is what the model
 * is handed and what gets stored, neither of which a direct call to the
 * renderer would show.
 */
describe('committee summary — the deterministic split', () => {
  const a = (role: string | null, name: string): CommitteeAssignment => ({
    role,
    name,
  });

  // Alvarez's real assignments (ca-assembly-80, read 2026-10-20).
  const ALVAREZ = [
    a('Chair', 'Select Committee on California-Mexico Bi-National Affairs'),
    a('Chair', 'Subcommittee No. 3 on Education Finance'),
    a('Co-Chair', 'Select Committee on the Transportation Costs'),
    a('Member', 'Budget'),
    a('Member', 'Rules'),
    a('Member', 'Water, Parks, and Wildlife'),
  ];

  const run = async (
    committees: CommitteeAssignment[],
    llmSummary: string,
    name = 'David A. Alvarez',
  ) => {
    const update = jest.fn().mockResolvedValue({});
    const generate = jest
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ summary: llmSummary }) });
    const getDocumentAnalysisPrompt = jest.fn().mockResolvedValue({
      promptText: 'PROMPT {{TEXT}}',
      promptHash: 'h',
      promptVersion: 'v4',
    });

    // `createMock<DbService>` rather than `as never`: the maximally
    // permissive cast disabled all checking of the mock shapes, so the
    // service reaching for a delegate the mock lacks would compile and only
    // fail at runtime. The sibling spec for this service already does this.
    const db = createMock<DbService>();
    (db.representative.findMany as unknown as jest.Mock).mockResolvedValue([
      { id: 'r1', name, chamber: 'Assembly', committees },
    ]);
    (db.representative.update as unknown as jest.Mock).mockImplementation(
      update,
    );

    const service = new CommitteeSummaryGeneratorService(
      { get: () => undefined } as unknown as ConfigService,
      { getDocumentAnalysisPrompt } as unknown as PromptClientService,
      {
        generate,
        getModelName: () => 'm',
        getModelDigest: () => 'd',
      } as unknown as ILLMProvider,
      db,
    );

    await service.generateMissingSummaries();

    return {
      promptInput: getDocumentAnalysisPrompt.mock.calls[0]?.[0]?.text as string,
      stored: update.mock.calls[0]?.[0]?.data?.committeesSummary as
        | string
        | undefined,
      persisted: update.mock.calls[0]?.[0]?.data as
        | Record<string, unknown>
        | undefined,
      updateCalls: update.mock.calls.length,
      llmCalled: generate.mock.calls.length,
    };
  };

  it('never shows the model a role', async () => {
    const { promptInput } = await run(ALVAREZ, 'Alvarez covers budget policy.');

    expect(promptInput).toContain('Committee Memberships:');
    // The three named roles and their committees must be absent entirely:
    // a role it is never given is a role it cannot misattribute.
    expect(promptInput).not.toMatch(/Chair|Co-Chair|Vice Chair/);
    expect(promptInput).not.toContain('California-Mexico');
    expect(promptInput).not.toContain('Education Finance');
    // Membership committees, and only those.
    expect(promptInput).toContain('- Budget');
    expect(promptInput).toContain('- Rules');
  });

  it('appends the exact role clause to the policy sentence', async () => {
    const { stored } = await run(
      ALVAREZ,
      'Alvarez serves on committees covering budget and natural resources, and on Rules.',
    );

    expect(stored).toBe(
      'Alvarez serves on committees covering budget and natural resources, ' +
        'and on Rules. Alvarez is Chair of the Select Committee on ' +
        'California-Mexico Bi-National Affairs and the Subcommittee No. 3 on ' +
        'Education Finance, and Co-Chair of the Select Committee on the ' +
        'Transportation Costs.',
    );
  });

  it('discards a policy sentence that claims a role', async () => {
    // The model was given no roles, so any role word is invented. The real
    // roles survive in the deterministic clause.
    const { stored } = await run(
      ALVAREZ,
      'Alvarez chairs the Rules Committee and covers budget policy.',
    );

    expect(stored).toBe(
      'Alvarez is Chair of the Select Committee on California-Mexico ' +
        'Bi-National Affairs and the Subcommittee No. 3 on Education Finance, ' +
        'and Co-Chair of the Select Committee on the Transportation Costs.',
    );
  });

  it.each([
    'Alvarez chairs budget policy.',
    'Alvarez is Vice Chair of budget policy.',
    'Alvarez is Co-Chair of budget policy.',
    'Alvarez is vice-chair of budget policy.',
    'Alvarez is the chairman of budget policy.',
    'Alvarez leads the budget committees.',
    'Alvarez heads the budget committees.',
  ])('rejects the invented role in %j', async (sentence) => {
    const { stored } = await run(ALVAREZ, sentence);

    expect(stored).not.toContain('budget policy');
    expect(stored).not.toContain('budget committees');
  });

  it('keeps a policy sentence that names a procedural committee', async () => {
    // "Rules" is a committee name, not a role claim — naming it is RULE 2.
    const { stored } = await run(
      ALVAREZ,
      'Alvarez serves on committees covering budget and water policy, and on the Rules Committee.',
    );

    expect(stored).toContain('and on the Rules Committee.');
  });

  it('skips the model entirely when every assignment is a named role', async () => {
    // Nothing to summarise, so there is no call to make and no sentence to
    // write — the role clause alone is a complete summary.
    const { stored, llmCalled } = await run(
      [a('Chair', 'Budget'), a('Vice Chair', 'Health')],
      'unused',
    );

    expect(llmCalled).toBe(0);
    expect(stored).toBe(
      'Alvarez is Chair of the Budget Committee, and Vice Chair of the ' +
        'Health Committee.',
    );
  });

  it('stores only the policy sentence when there are no named roles', async () => {
    const { stored } = await run(
      [a('Member', 'Budget'), a(null, 'Health')],
      'Bains serves on committees covering budget and health policy.',
      'Jasmeet Bains',
    );

    expect(stored).toBe(
      'Bains serves on committees covering budget and health policy.',
    );
  });

  it('stores nothing when the model fails and there are no named roles', async () => {
    // Asserts the WRITE did not happen. Reading `stored` off
    // `update.mock.calls[0]?.[0]?.data` is undefined whenever `update` was
    // never called — including for an unrelated reason, such as the findMany
    // mock shape drifting so no candidate is found.
    const { stored, updateCalls } = await run(
      [a('Member', 'Budget')],
      'Bains chairs the Budget Committee.',
      'Jasmeet Bains',
    );

    expect(updateCalls).toBe(0);
    expect(stored).toBeUndefined();
  });

  describe('attribution follows the text, not the call', () => {
    const AI_COLUMNS = [
      'committeesSummaryPromptHash',
      'committeesSummaryPromptVersion',
      'committeesSummaryLlmModel',
      'committeesSummaryLlmDigest',
    ] as const;

    it('records no AI attribution when the model was never called', async () => {
      // Every stored word came from `renderRoleClause`. Stamping it with a
      // prompt hash and a model name is `clearedAiAttribution`'s
      // misattribution pointing the other way: claiming a model wrote text
      // it did not write.
      const { persisted, llmCalled } = await run(
        [a('Chair', 'Budget'), a('Vice Chair', 'Health')],
        'unused',
      );

      expect(llmCalled).toBe(0);
      for (const column of AI_COLUMNS) expect(persisted?.[column]).toBeNull();
    });

    it('records no AI attribution when the guard discarded the sentence', async () => {
      // The model ran, but nothing it produced survived — so the stored text
      // is again wholly deterministic.
      const { persisted, llmCalled } = await run(
        ALVAREZ,
        'Alvarez chairs the Rules Committee and covers budget policy.',
      );

      expect(llmCalled).toBe(1);
      for (const column of AI_COLUMNS) expect(persisted?.[column]).toBeNull();
    });

    it('records attribution when the model sentence survives', async () => {
      const { persisted } = await run(
        ALVAREZ,
        'Alvarez serves on committees covering budget and water policy.',
      );

      expect(persisted?.committeesSummaryPromptHash).toBe('h');
      expect(persisted?.committeesSummaryPromptVersion).toBe('v4');
      expect(persisted?.committeesSummaryLlmModel).toBe('m');
      expect(persisted?.committeesSummaryLlmDigest).toBe('d');
    });
  });
});

import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PropositionsSyncService } from './propositions-sync.service';
import { SourceVersionService } from './source-version.service';

/**
 * A claim's citation indexes into `full_text`, not into the archived page it
 * was extracted from (#1306). What ties the two together is the derivation
 * recorded here — and it is recorded from the string the upsert just wrote,
 * at the point it was written.
 *
 * Scoped to that hook. The chain end-to-end is covered by
 * `__tests__/integration/region/source-version-derivation.integration.spec.ts`.
 */
describe('PropositionsSyncService — source derivation', () => {
  const PROP = {
    externalId: '25-0001',
    title: 'Transfer tax',
    summary: 'Raises the tax.',
    fullText: 'The measure would raise the documentary transfer tax.',
    status: 'qualified',
    sourceVersionId: 'sv-1',
  };

  const provider = {
    getName: () => 'california',
    fetchPropositions: jest.fn(),
  };

  let attachDerivedText: jest.Mock;
  let upsert: jest.Mock;

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropositionsSyncService,
        {
          provide: DbService,
          useValue: {
            proposition: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: SourceVersionService,
          useValue: { attachDerivedText },
        },
      ] as never[],
    }).compile();

    return moduleRef.get(PropositionsSyncService);
  }

  const run = (service: PropositionsSyncService) =>
    service.sync(provider as never, undefined, [], upsert as never);

  beforeEach(() => {
    jest.clearAllMocks();
    attachDerivedText = jest.fn().mockResolvedValue(true);
    provider.fetchPropositions.mockResolvedValue([PROP]);
    upsert = jest
      .fn()
      .mockResolvedValue({ processed: 1, created: 1, updated: 0 });
  });

  it('records the text it just wrote against the page it came from', async () => {
    await run(await build());

    // The value passed is `fullText` itself — the same string the upsert
    // stored — not anything re-read or re-derived. `Evidence.spanStart` and
    // `spanEnd` index into exactly this.
    expect(attachDerivedText).toHaveBeenCalledWith('sv-1', PROP.fullText);
  });

  it('records nothing for a measure whose source was never archived', async () => {
    provider.fetchPropositions.mockResolvedValue([
      { ...PROP, sourceVersionId: undefined },
    ]);

    await run(await build());

    // No archived bytes means no derivation to attach. A row here would
    // describe an artifact nobody kept.
    expect(attachDerivedText).not.toHaveBeenCalled();
  });

  it('records nothing when the batch wrote nothing', async () => {
    // The #1219 failure mode: these upserts share one transaction, so a single
    // invalid record rolls back every other row and the run still returns.
    upsert.mockResolvedValue({ processed: 1, created: 0, updated: 0 });

    await run(await build());

    // The derivation is write-once. Recording it for a row that was rolled
    // back would let the failed run's extraction win over the one that
    // eventually succeeds.
    expect(attachDerivedText).not.toHaveBeenCalled();
  });

  it('does not fail the sync when the derivation cannot be recorded', async () => {
    attachDerivedText.mockRejectedValue(new Error('archive unavailable'));

    // Same trade as archiving itself: losing a derivation costs one measure's
    // claims their traceability; a throw here costs the civic data for all of
    // them, on the nightly cron.
    await expect(run(await build())).resolves.toBeDefined();
  });
});

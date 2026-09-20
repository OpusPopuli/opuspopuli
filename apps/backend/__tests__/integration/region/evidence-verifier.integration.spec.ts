/**
 * Integration test for the verify-or-snap gate (#1292).
 *
 * The unit spec covers the decision as a pure function. This covers the thing
 * the acceptance criterion actually asks for: that the gate's verdicts land in
 * the database in a shape where the distribution is a query — so the eval
 * harness's measured anchoring rate stays reproducible from stored rows rather
 * than living only in a report.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { verifyEvidence } from '../../../src/apps/region/src/domains/evidence-verifier';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const SOURCE =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');
const HASH = sha256(SOURCE);

const CLAIM = 'The measure raises the documentary transfer tax.';
const QUOTE = 'raise the documentary transfer tax';

describe('verify-or-snap gate (#1292)', () => {
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

  /** Store a claim + citation, run it through the gate, persist the verdict. */
  async function gate(
    claimText: string,
    citation: {
      spanStart?: number | null;
      spanEnd?: number | null;
      quotedText?: string | null;
      citationHint?: string | null;
    },
    sourceText: string = SOURCE,
    sourceHash: string = HASH,
  ) {
    const claim = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'prop-1',
        text: claimText,
      },
    });

    const stored = {
      sourceTextHash: HASH,
      spanStart: citation.spanStart ?? null,
      spanEnd: citation.spanEnd ?? null,
      quotedText: citation.quotedText ?? null,
      citationHint: citation.citationHint ?? null,
    };

    const outcome = verifyEvidence(claimText, stored, sourceText, sourceHash);

    const evidence = await db.evidence.create({
      data: {
        ...stored,
        state: outcome.state,
        // Snapping corrects the span; the state records that it was moved.
        ...(outcome.correctedSpan && {
          spanStart: outcome.correctedSpan.start,
          spanEnd: outcome.correctedSpan.end,
        }),
      },
    });
    await db.claimEvidence.create({
      data: { claimId: claim.id, evidenceId: evidence.id },
    });

    return { claim, evidence, outcome };
  }

  it('stores a verified verdict for a citation that supports its claim', async () => {
    const start = SOURCE.indexOf('raise');
    const { evidence } = await gate(CLAIM, {
      spanStart: start,
      spanEnd: start + 60,
    });

    const stored = await db.evidence.findUnique({ where: { id: evidence.id } });
    expect(stored!.state).toBe('verified');
  });

  it('stores unverified for a span that is in range but unsupported', async () => {
    const start = SOURCE.indexOf('affordable');
    const { evidence } = await gate(CLAIM, {
      spanStart: start,
      spanEnd: SOURCE.length,
    });

    // The failure the gate exists for: the write path clamps offsets into
    // range, so "in range" is guaranteed and proves nothing.
    const stored = await db.evidence.findUnique({ where: { id: evidence.id } });
    expect(stored!.state).toBe('unverified');
  });

  it('persists the corrected span when a quote is relocated', async () => {
    const { evidence } = await gate(CLAIM, {
      quotedText: QUOTE,
      spanStart: 0,
      spanEnd: 10,
    });

    const stored = await db.evidence.findUnique({ where: { id: evidence.id } });
    expect(stored!.state).toBe('snapped');
    // The span is corrected, and `snapped` records that it was moved rather
    // than presenting it as the model's own citation.
    expect(stored!.spanStart).toBe(SOURCE.indexOf(QUOTE));
    expect(stored!.spanEnd).toBe(SOURCE.indexOf(QUOTE) + QUOTE.length);
  });

  it('keeps unsourced distinct from unverified in stored rows', async () => {
    await gate('Served two terms.', {});
    await gate(CLAIM, { citationHint: 'see page 4' });

    const unsourced = await db.evidence.count({
      where: { state: 'unsourced' },
    });
    const unverified = await db.evidence.count({
      where: { state: 'unverified' },
    });

    expect(unsourced).toBe(1);
    expect(unverified).toBe(1);
  });

  it('refuses to verify against text that changed after the claim', async () => {
    const amended = SOURCE.replace('five million', 'three million');
    const start = SOURCE.indexOf('raise');

    const { evidence } = await gate(
      CLAIM,
      { spanStart: start, spanEnd: start + 60 },
      amended,
      sha256(amended),
    );

    const stored = await db.evidence.findUnique({ where: { id: evidence.id } });
    expect(stored!.state).toBe('unverified');
  });

  it('makes the verdict distribution a query', async () => {
    const supported = SOURCE.indexOf('raise');
    const unsupported = SOURCE.indexOf('affordable');

    await gate(CLAIM, { spanStart: supported, spanEnd: supported + 60 });
    await gate(CLAIM, { spanStart: unsupported, spanEnd: SOURCE.length });
    await gate(CLAIM, { spanStart: unsupported, spanEnd: SOURCE.length });
    await gate(CLAIM, { quotedText: QUOTE, spanStart: 0, spanEnd: 10 });
    await gate('Served two terms.', {});

    const rows = await db.evidence.groupBy({
      by: ['state'],
      _count: { state: true },
    });
    const byState = Object.fromEntries(
      rows.map((r) => [r.state, r._count.state]),
    );

    // This issue's acceptance criterion: the anchoring rate is reproducible
    // from stored rows, not only from a harness report. 1 of 4 checkable
    // citations verified here — the honest shape of the answer, and the same
    // scoring the harness uses via @opuspopuli/common.
    expect(byState).toEqual({
      verified: 1,
      unverified: 2,
      snapped: 1,
      unsourced: 1,
    });
  });

  it('finds claims with no verified evidence — the epic target query', async () => {
    const supported = SOURCE.indexOf('raise');
    await gate(CLAIM, { spanStart: supported, spanEnd: supported + 60 });
    await gate(CLAIM, {
      spanStart: SOURCE.indexOf('affordable'),
      spanEnd: SOURCE.length,
    });
    await gate('Served two terms.', {});

    const unevidenced = await db.claim.count({
      where: { evidence: { none: { evidence: { state: 'verified' } } } },
    });

    expect(unevidenced).toBe(2);
  });
});

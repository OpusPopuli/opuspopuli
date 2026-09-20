/**
 * Integration test for the Claim / Evidence relational core (#1291, epic #1208).
 *
 * The unit spec covers span resolution as a pure function. What it cannot cover
 * is the thing this issue actually builds: whether a claim resolves through
 * evidence, to a source version, to the exact stored bytes — a chain of four
 * tables and three foreign keys whose delete semantics were chosen
 * deliberately and differ from each other.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { resolveEvidenceSpan } from '../../../src/apps/region/src/domains/evidence-span';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const FULL_TEXT =
  'The measure would raise the transfer tax on properties over $5 million.';
const SPAN_START = 18;
const SPAN_END = 41;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('claim/evidence core (#1291)', () => {
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

  async function seedSource() {
    const content = Buffer.from(
      `<html><body>${FULL_TEXT}</body></html>`,
      'utf8',
    );
    return db.sourceVersion.create({
      data: {
        contentHash: createHash('sha256').update(content).digest('hex'),
        content,
        byteSize: content.length,
        sourceUrl: 'https://oag.ca.gov/initiatives/25-0001',
        fetchedAt: new Date('2026-09-19T10:00:00.000Z'),
      },
    });
  }

  async function seedClaim(
    opts: {
      state?: 'verified' | 'snapped' | 'unverified' | 'unsourced';
      sourceVersionId?: string | null;
      spanStart?: number | null;
      spanEnd?: number | null;
      textHash?: string | null;
    } = {},
  ) {
    const claim = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'prop-1',
        subjectField: 'fiscalImpact',
        text: 'The measure raises the transfer tax.',
        confidence: 0.8,
      },
    });
    const evidence = await db.evidence.create({
      data: {
        state: opts.state ?? 'unverified',
        sourceVersionId: opts.sourceVersionId ?? null,
        sourceTextHash:
          opts.textHash === undefined ? sha256(FULL_TEXT) : opts.textHash,
        spanStart: opts.spanStart === undefined ? SPAN_START : opts.spanStart,
        spanEnd: opts.spanEnd === undefined ? SPAN_END : opts.spanEnd,
      },
    });
    await db.claimEvidence.create({
      data: { claimId: claim.id, evidenceId: evidence.id },
    });
    return { claim, evidence };
  }

  it('resolves a claim through evidence to the exact stored bytes', async () => {
    const source = await seedSource();
    const { claim } = await seedClaim({
      sourceVersionId: source.id,
      state: 'verified',
    });

    const loaded = await db.claim.findUnique({
      where: { id: claim.id },
      include: {
        evidence: {
          include: { evidence: { include: { sourceVersion: true } } },
        },
      },
    });

    const link = loaded!.evidence[0].evidence;
    expect(link.sourceVersion).not.toBeNull();

    // The chain the epic asks for: claim -> evidence -> source version -> the
    // bytes that were actually fetched.
    const stored = link.sourceVersion!.content.toString('utf8');
    expect(stored).toContain(FULL_TEXT);

    const resolved = resolveEvidenceSpan(FULL_TEXT, sha256(FULL_TEXT), link);
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') return;
    expect(resolved.text).toBe(FULL_TEXT.slice(SPAN_START, SPAN_END));
  });

  it('reports staleness when the derived text has changed', async () => {
    const source = await seedSource();
    const { claim } = await seedClaim({ sourceVersionId: source.id });

    const loaded = await db.claim.findUnique({
      where: { id: claim.id },
      include: { evidence: { include: { evidence: true } } },
    });
    const link = loaded!.evidence[0].evidence;

    const amended = FULL_TEXT.replace('$5 million', '$3 million');
    const resolved = resolveEvidenceSpan(amended, sha256(amended), link);

    // The text was upserted in place — exactly what #1279's hash exists to
    // catch. A re-slice against amended text would quote words the claim never
    // saw, at offsets that still happen to be in range.
    expect(resolved.status).toBe('stale');
  });

  it('accepts evidence with no source version, for claims that predate the archive', async () => {
    const { claim } = await seedClaim({ sourceVersionId: null });

    const loaded = await db.claim.findUnique({
      where: { id: claim.id },
      include: { evidence: { include: { evidence: true } } },
    });

    // Every claim that exists today is in this state: the archive only began
    // filling this cycle. Null means "predates archiving", not "source
    // unknown", and the text hash still anchors the span.
    const link = loaded!.evidence[0].evidence;
    expect(link.sourceVersionId).toBeNull();
    expect(link.sourceTextHash).toBe(sha256(FULL_TEXT));
  });

  it('keeps unsourced distinguishable from unverified', async () => {
    await seedClaim({ state: 'unsourced', spanStart: null, spanEnd: null });
    await seedClaim({ state: 'unverified' });

    const unsourced = await db.evidence.count({
      where: { state: 'unsourced' },
    });
    const unverified = await db.evidence.count({
      where: { state: 'unverified' },
    });

    // bio_claims' origin:'training' is a claim that never had a citation. That
    // is not the same as a citation that failed a check, and #1208 is explicit
    // it must not be laundered into looking sourced.
    expect(unsourced).toBe(1);
    expect(unverified).toBe(1);
  });

  it('keeps the claim when its producing run is deleted', async () => {
    const execution = await db.pipelineExecution.create({
      data: {
        regionId: 'us-ca',
        sourceUrl: 'https://x',
        dataType: 'propositions',
      },
    });
    const claim = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'prop-1',
        text: 'A claim.',
        pipelineExecutionId: execution.id,
      },
    });

    await db.pipelineExecution.delete({ where: { id: execution.id } });

    // ON DELETE SET NULL: pruning pipeline bookkeeping must never delete the
    // claims that run produced.
    const survived = await db.claim.findUnique({ where: { id: claim.id } });
    expect(survived).not.toBeNull();
    expect(survived!.pipelineExecutionId).toBeNull();
  });

  it('keeps evidence when a pruned source version is cleared', async () => {
    const source = await seedSource();
    const { evidence } = await seedClaim({ sourceVersionId: source.id });

    await db.sourceVersion.delete({ where: { id: source.id } });

    // The bulk tier prunes payloads on a retention schedule (#1277); a
    // citation stays meaningful through its text hash after the bytes go.
    const survived = await db.evidence.findUnique({
      where: { id: evidence.id },
    });
    expect(survived).not.toBeNull();
    expect(survived!.sourceVersionId).toBeNull();
    expect(survived!.sourceTextHash).toBe(sha256(FULL_TEXT));
  });

  it('removes the join row when a claim is deleted', async () => {
    const { claim } = await seedClaim();

    await db.claim.delete({ where: { id: claim.id } });

    // CASCADE here, unlike the provenance links: a join row with one end
    // missing would leave the graph asserting a citation that no longer exists.
    expect(await db.claimEvidence.count()).toBe(0);
  });

  it('records relations between claims and rejects a duplicate edge', async () => {
    const a = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'p1',
        text: 'Raises taxes.',
      },
    });
    const b = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'p1',
        text: 'Lowers taxes.',
      },
    });

    await db.claimRelation.create({
      data: { fromClaimId: a.id, toClaimId: b.id, kind: 'contradicts' },
    });

    // A second identical assertion is not new information.
    await expect(
      db.claimRelation.create({
        data: { fromClaimId: a.id, toClaimId: b.id, kind: 'contradicts' },
      }),
    ).rejects.toThrow();

    // A different kind between the same pair is, though.
    await expect(
      db.claimRelation.create({
        data: { fromClaimId: a.id, toClaimId: b.id, kind: 'qualifies' },
      }),
    ).resolves.toBeTruthy();
  });

  it('finds claims lacking verified evidence — the query this epic exists for', async () => {
    const source = await seedSource();
    await seedClaim({ sourceVersionId: source.id, state: 'verified' });
    await seedClaim({ state: 'unverified' });
    await seedClaim({ state: 'unsourced', spanStart: null, spanEnd: null });

    const unevidenced = await db.claim.count({
      where: { evidence: { none: { evidence: { state: 'verified' } } } },
    });

    // "Show every published assertion that lacks primary evidence" — a query
    // rather than an audit project. Two of three here, which is the honest
    // shape of the answer before any backfill.
    expect(unevidenced).toBe(2);
  });
});

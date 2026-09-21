/**
 * Integration test for the producer half of the provenance chain (#1306).
 *
 * #1296 built the consumer — claim → evidence → SourceVersion → passage —
 * against hand-inserted rows. This drives the **production write path** for
 * the same chain: the archive records the bytes, the sync records what was
 * extracted from them, the recorder links the claims, and only then does the
 * resolver run. Nothing here inserts an `evidence` row directly, because the
 * failure this issue exists to prevent was precisely a chain that looked
 * correct in fixtures and produced nothing in a real sync.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { ClaimSourceResolverService } from '../../../src/apps/region/src/domains/claim-source-resolver.service';
import { recordClaims } from '../../../src/apps/region/src/domains/claim-recorder';
import { normaliseAnalysisClaims } from '../../../src/apps/region/src/domains/claim-normalisers';
import { rowProvenance } from '../../../src/apps/region/src/domains/row-provenance';
import { SourceVersionService } from '../../../src/apps/region/src/domains/source-version.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

/** The sentence a claim will quote — what the extraction produces. */
const QUOTE =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars.';

/** `full_text` as the sync writes it. */
const EXTRACTED = `Measure 25-0001. ${QUOTE} Revenue is directed to affordable housing construction.`;

/**
 * The body as fetched. Markup on both sides of the sentence, so every offset
 * into this differs from the offset into EXTRACTED — the property that makes
 * storing the derivation necessary rather than merely convenient.
 */
const FETCHED_HTML =
  '<!doctype html><html><head><title>Measure 25-0001</title></head>' +
  `<body><nav>Skip to content</nav><main><p>${EXTRACTED}</p></main></body></html>`;

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const bytesOf = (value: string) => Buffer.from(value, 'utf8');

describe('source version derivation (#1306)', () => {
  let db: DbService;
  let sourceVersions: SourceVersionService;
  let resolver: ClaimSourceResolverService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    sourceVersions = new SourceVersionService(db);
    resolver = new ClaimSourceResolverService(db);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** Archive a fetch exactly as `PrismaSourceArchive` does. */
  async function archive(body = FETCHED_HTML) {
    const content = bytesOf(body);
    const result = await sourceVersions.record({
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      fetchedAt: '2026-09-21T00:00:00.000Z',
      sourceUrl: 'https://example.test/measure/25-0001',
      contentType: 'text/html',
    });
    expect(result.sourceVersionId).toBeDefined();
    return result.sourceVersionId!;
  }

  /** Write the proposition row the way `propositions-sync` does. */
  async function upsertProposition(sourceVersionId: string | null) {
    return db.proposition.create({
      data: {
        externalId: '25-0001',
        title: 'Documentary transfer tax',
        summary: 'Raises the transfer tax on high-value homes.',
        fullText: EXTRACTED,
        status: 'qualified',
        regionPluginName: 'california',
        ...rowProvenance({ sourceVersionId: sourceVersionId ?? undefined }),
      },
      select: { id: true, sourceVersionId: true },
    });
  }

  /** One analysis claim quoting the source, as the generator emits it. */
  function claims(quote = QUOTE) {
    return normaliseAnalysisClaims([
      {
        field: 'analysisSummary',
        claim: 'The measure raises the documentary transfer tax.',
        confidence: 'high',
        sourceQuote: quote,
      },
    ] as never);
  }

  async function record(propositionId: string, sourceVersionId: string | null) {
    return recordClaims(db, {
      subjectType: 'proposition',
      subjectId: propositionId,
      claims: claims(),
      sourceText: EXTRACTED,
      sourceTextHash: sha256(EXTRACTED),
      sourceVersionId,
    });
  }

  it('traces a claim to the archived bytes, end to end through the write path', async () => {
    const sourceVersionId = await archive();
    const prop = await upsertProposition(sourceVersionId);

    // What the upsert does with the string it just wrote to `full_text`.
    await sourceVersions.attachDerivedText(sourceVersionId, EXTRACTED);
    await record(prop.id, prop.sourceVersionId);

    const [claim] = await db.claim.findMany({
      where: { subjectId: prop.id },
      select: { id: true },
    });
    const result = await resolver.resolve(claim.id);

    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.passage).toContain('documentary transfer tax');
    // The passage came from the extraction; the identity came from the bytes.
    expect(result.passage).not.toContain('<');
    expect(result.contentHash).toBe(
      createHash('sha256').update(bytesOf(FETCHED_HTML)).digest('hex'),
    );
  });

  it('links a regeneration whose claims are otherwise identical', async () => {
    const sourceVersionId = await archive();
    const prop = await upsertProposition(sourceVersionId);
    await sourceVersions.attachDerivedText(sourceVersionId, EXTRACTED);

    // First pass: the corpus as it exists before this issue — claims recorded
    // with no idea which bytes they rest on.
    await record(prop.id, null);
    const before = await db.evidence.findMany({
      select: { sourceVersionId: true },
    });
    expect(before.every((e) => e.sourceVersionId === null)).toBe(true);

    // Second pass: same text, same quote, same verdict — everything the
    // signature compares is unchanged EXCEPT the source link.
    await record(prop.id, sourceVersionId);

    const after = await db.evidence.findMany({
      where: { sourceVersionId: { not: null } },
      select: { sourceVersionId: true },
    });
    // Without `sourceVersionId` in the claim signature this run compares equal
    // to the last and is skipped as a no-op, leaving the whole corpus
    // permanently unlinked — a green suite over a chain that never connects.
    expect(after).toHaveLength(1);
    expect(after[0].sourceVersionId).toBe(sourceVersionId);
  });

  it('keeps the first derivation when a later extraction disagrees', async () => {
    const sourceVersionId = await archive();

    expect(
      await sourceVersions.attachDerivedText(sourceVersionId, EXTRACTED),
    ).toBe(true);
    // A second sync extracts something different from the same bytes — a new
    // selector plan, say. The stored derivation is what existing evidence was
    // checked against, so it wins.
    expect(
      await sourceVersions.attachDerivedText(sourceVersionId, 'Something else'),
    ).toBe(false);

    const stored = await db.sourceVersion.findUnique({
      where: { id: sourceVersionId },
      select: { derivedText: true, derivedTextHash: true },
    });
    expect(stored?.derivedText).toBe(EXTRACTED);
    expect(stored?.derivedTextHash).toBe(sha256(EXTRACTED));
  });

  it('drops the link when a row is rewritten from an unarchived fetch', async () => {
    const sourceVersionId = await archive();
    const prop = await upsertProposition(sourceVersionId);
    expect(prop.sourceVersionId).toBe(sourceVersionId);

    // The #1280 rule, applied to this column: a sync that archived nothing
    // must write an explicit NULL. Leaving the field out of the update would
    // keep the row pointing at the previous fetch's bytes — a stale reference
    // that reads as current, which is worse than no reference at all.
    const rewritten = await db.proposition.update({
      where: { id: prop.id },
      data: { ...rowProvenance({}) },
      select: { sourceVersionId: true },
    });

    expect(rewritten.sourceVersionId).toBeNull();
  });

  it('archives the bytes once however many rows derive from them', async () => {
    const first = await archive();
    const second = await archive();

    // Content-addressed: the same page fetched twice is one artifact, and the
    // second fetch gets the id of the first rather than a duplicate row.
    expect(second).toBe(first);
    await expect(db.sourceVersion.count()).resolves.toBe(1);
  });
});

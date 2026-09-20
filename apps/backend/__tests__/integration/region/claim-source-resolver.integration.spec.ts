/**
 * Integration test for claim → stored bytes (#1296).
 *
 * The epic's chain: claim → evidence → SourceVersion → the passage, re-derived
 * at read time. Re-derived rather than stored, so the archived bytes stay the
 * only thing that has to be trusted.
 *
 * Real database, per the integration-test convention — and necessarily so:
 * the bytes live in a BYTEA column and the whole point is decoding them back
 * out of Postgres exactly as they went in.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { ClaimSourceResolverService } from '../../../src/apps/region/src/domains/claim-source-resolver.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const PAGE =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

const sha256 = (v: Buffer | string) =>
  createHash('sha256')
    .update(typeof v === 'string' ? Buffer.from(v, 'utf8') : v)
    .digest('hex');

describe('claim source resolver (#1296)', () => {
  let db: DbService;
  let service: ClaimSourceResolverService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    service = new ClaimSourceResolverService(db);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** A claim with evidence, optionally linked to archived bytes. */
  async function seed(opts: {
    link?: boolean;
    text?: string;
    spanStart?: number;
    spanEnd?: number;
    storedTextHash?: string;
  }) {
    const text = opts.text ?? PAGE;
    const bytes = Buffer.from(text, 'utf8');

    const version = opts.link
      ? await db.sourceVersion.create({
          data: {
            contentHash: sha256(bytes),
            content: bytes,
            byteSize: bytes.byteLength,
            sourceUrl: 'https://example.test/measure/25-0001',
            fetchedAt: new Date('2026-09-01T00:00:00Z'),
          },
        })
      : null;

    const claim = await db.claim.create({
      data: {
        subjectType: 'proposition',
        subjectId: 'prop-r',
        text: 'The measure raises the documentary transfer tax.',
      },
    });
    const evidence = await db.evidence.create({
      data: {
        state: 'verified',
        sourceVersionId: version?.id ?? null,
        sourceTextHash: opts.storedTextHash ?? sha256(text),
        spanStart: opts.spanStart ?? text.indexOf('raise'),
        spanEnd: opts.spanEnd ?? text.indexOf('raise') + 60,
      },
    });
    await db.claimEvidence.create({
      data: { claimId: claim.id, evidenceId: evidence.id },
    });
    return claim.id;
  }

  it('re-derives the passage from the archived bytes', async () => {
    const claimId = await seed({ link: true });

    const result = await service.resolve(claimId);

    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    // Sliced out of the BYTEA column at read time, not stored alongside.
    expect(result.passage).toContain('raise the documentary transfer tax');
    expect(result.sourceUrl).toBe('https://example.test/measure/25-0001');
    expect(result.contentHash).toBe(sha256(Buffer.from(PAGE, 'utf8')));
  });

  it('refuses when the derived text is not what the citation was checked against', async () => {
    // The stored hash names a different text version than the bytes decode to.
    const claimId = await seed({ link: true, storedTextHash: sha256('other') });

    const result = await service.resolve(claimId);

    // Returning the characters at those offsets anyway would quote the source
    // as saying something it may never have said.
    expect(result).toEqual({ resolved: false, reason: 'source-changed' });
  });

  it('refuses a span that does not fit the archived text', async () => {
    const claimId = await seed({
      link: true,
      spanStart: 0,
      spanEnd: PAGE.length + 500,
    });

    const result = await service.resolve(claimId);

    expect(result).toEqual({ resolved: false, reason: 'span-unusable' });
  });

  it('reports honestly when no bytes were ever archived', async () => {
    const claimId = await seed({ link: false });

    const result = await service.resolve(claimId);

    // The state of every row in production today: #1276 built the store and
    // #1280 built row provenance, but nothing carries the SourceVersion id
    // from the archive write onto the subject row yet, so no evidence points
    // at one. `no-archived-source` is the truth, not an error — and this test
    // exists so a green suite cannot imply a working chain.
    expect(result).toEqual({ resolved: false, reason: 'no-archived-source' });
  });

  it('distinguishes a missing claim from an untraceable one', async () => {
    await expect(
      service.resolve('00000000-0000-0000-0000-000000000000'),
    ).resolves.toEqual({ resolved: false, reason: 'claim-not-found' });
  });

  it('reports a claim that carries no evidence at all', async () => {
    const claim = await db.claim.create({
      data: { subjectType: 'proposition', subjectId: 'p', text: 'Bare.' },
    });

    await expect(service.resolve(claim.id)).resolves.toEqual({
      resolved: false,
      reason: 'no-evidence',
    });
  });
});

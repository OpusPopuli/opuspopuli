/**
 * Integration test for claim → stored bytes (#1296, #1306).
 *
 * The epic's chain: claim → evidence → SourceVersion → the passage, sliced at
 * read time out of the derivation recorded beside the bytes.
 *
 * Real database, per the integration-test convention — and necessarily so:
 * the bytes live in a BYTEA column and the whole point is reading them back
 * out of Postgres exactly as they went in.
 *
 * ## The fixture deliberately does not use plain text as the archived body
 *
 * Until #1306 this suite archived the derived text AS the bytes, so decoding
 * `content` produced exactly the string the spans indexed into. Every test
 * passed, on a shape that does not occur: real archived bodies are PDFs and
 * HTML pages, and the extracted text is never equal to them. The suite was
 * asserting the resolver against the one input that hid its central
 * assumption. `ARCHIVED_HTML` below is what keeps that from recurring.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { ClaimSourceResolverService } from '../../../src/apps/region/src/domains/claim-source-resolver.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

/** What the extraction produced — the string `full_text` would hold. */
const PAGE =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

/**
 * What was actually fetched and archived. Shares no offsets with PAGE: the
 * markup alone pushes every character of the body past where the citation
 * says it is, which is the whole reason the derivation is stored separately.
 */
const ARCHIVED_HTML =
  '<!doctype html><html><head><title>Measure 25-0001</title></head>' +
  `<body><nav>Skip to content</nav><article><p>${PAGE}</p></article>` +
  '<footer>Contact the proponent</footer></body></html>';

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
    /** Archive the bytes but record no derivation (#1306). */
    withoutDerivation?: boolean;
  }) {
    const text = opts.text ?? PAGE;
    // The archived body is the PAGE markup, not the page text — the shape
    // every real fetch produces.
    const bytes = Buffer.from(ARCHIVED_HTML, 'utf8');

    const version = opts.link
      ? await db.sourceVersion.create({
          data: {
            contentHash: sha256(bytes),
            content: bytes,
            byteSize: bytes.byteLength,
            sourceUrl: 'https://example.test/measure/25-0001',
            fetchedAt: new Date('2026-09-01T00:00:00Z'),
            ...(opts.withoutDerivation
              ? {}
              : { derivedText: text, derivedTextHash: sha256(text) }),
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

  it('resolves the passage against the extraction, not the archived markup', async () => {
    const claimId = await seed({ link: true });

    const result = await service.resolve(claimId);

    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.passage).toContain('raise the documentary transfer tax');
    // Never the surrounding markup: the offsets address the extraction, and
    // slicing the decoded body at them would land somewhere in the <head>.
    expect(result.passage).not.toContain('<');
    expect(result.sourceUrl).toBe('https://example.test/measure/25-0001');
    // Still content-addressed to the BYTES, which is what proves the archive
    // holds the artifact it claims to.
    expect(result.contentHash).toBe(sha256(Buffer.from(ARCHIVED_HTML, 'utf8')));
  });

  it('separates "we never recorded the extraction" from "the source changed"', async () => {
    const claimId = await seed({ link: true, withoutDerivation: true });

    const result = await service.resolve(claimId);

    // The bytes ARE archived and hash correctly. What is missing is our own
    // record of what was pulled out of them — which cannot be recomputed,
    // because the CSS plan that produced it was LLM-derived per page. Saying
    // `source-changed` here would accuse the source of an alteration that
    // never happened.
    expect(result).toEqual({ resolved: false, reason: 'no-derived-text' });
  });

  it('refuses when the derived text is not what the citation was checked against', async () => {
    // The stored hash names a different text version than the derivation.
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

    // The state of every row written before #1306, and of any row whose
    // source was never archived. `no-archived-source` is the truth, not an
    // error — and this test exists so a green suite cannot imply that every
    // claim is traceable.
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

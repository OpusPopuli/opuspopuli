/**
 * Regression test for #1301 — `propositions.full_text_hash`.
 *
 * The bug this exists for shipped green. `full_text_hash` is GENERATED ALWAYS,
 * and a generation expression is **never evaluated against an empty table** —
 * so CI and `postgres_test`, which always start empty, could not have caught
 * a generation expression that rejects real text. The migration applied
 * cleanly and every existing test passed while the expression was wrong.
 *
 * The check is therefore not "does the migration apply" but "does a row
 * survive the round trip and hash the way the application hashes" — which is
 * only answerable by inserting adversarial text.
 *
 * The equivalence is load-bearing: the analysis staleness check (#1279)
 * compares this column against a hash Node computed. If the two disagree,
 * every proposition reads as stale forever and regenerates on every run.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

/**
 * Text that a `::bytea` cast mishandles, plus the ordinary cases.
 *
 * The first two are the bug: a bare backslash raises SQLSTATE 22P02, and a
 * valid escape sequence silently digests different bytes than the characters.
 */
const CASES: ReadonlyArray<{ name: string; text: string }> = [
  {
    name: 'a bare backslash',
    text: 'The measure amends section 4 \\ of the code.',
  },
  {
    name: 'a valid bytea escape sequence',
    text: 'Filed under a\\101c of the code.',
  },
  {
    name: 'doubled backslashes',
    text: 'Path-like text: C:\\\\ballot\\\\measure',
  },
  {
    name: 'plain ASCII',
    text: 'The measure raises the documentary transfer tax.',
  },
  {
    name: 'smart quotes and an em dash',
    text: 'The “measure” — as amended — applies.',
  },
  {
    name: 'Spanish accents',
    text: 'La medida aumentaría el impuesto sobre la transferencia.',
  },
  { name: 'the empty string', text: '' },
];

describe('propositions.full_text_hash (#1301)', () => {
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

  it.each(CASES)(
    'stores text containing $name and hashes it as Node does',
    async ({ text }) => {
      const row = await db.proposition.create({
        data: {
          externalId: `hash-probe-${sha256(text).slice(0, 12)}`,
          title: 'Hash probe',
          summary: 'Probe row.',
          fullText: text,
        },
        select: { id: true },
      });

      const [stored] = await db.$queryRaw<{ full_text_hash: string }[]>`
        SELECT full_text_hash FROM propositions WHERE id = ${row.id}
      `;

      expect(stored.full_text_hash).toBe(sha256(text));
    },
  );

  it('leaves the hash null when there is no text to hash', async () => {
    const row = await db.proposition.create({
      data: {
        externalId: 'hash-probe-null',
        title: 'No text',
        summary: 'Probe row.',
      },
      select: { id: true },
    });

    const [stored] = await db.$queryRaw<{ full_text_hash: string | null }[]>`
      SELECT full_text_hash FROM propositions WHERE id = ${row.id}
    `;

    // STRICT on the hashing function: no text, no hash — rather than the
    // digest of the empty string, which would make "never had text" and
    // "had empty text" indistinguishable.
    expect(stored.full_text_hash).toBeNull();
  });

  it('recomputes the hash when the text is rewritten in place', async () => {
    const row = await db.proposition.create({
      data: {
        externalId: 'hash-probe-rewrite',
        title: 'Rewritten',
        summary: 'Probe row.',
        fullText: 'Original text of the measure.',
      },
      select: { id: true },
    });

    const amended = 'Amended text of the measure \\ with a backslash.';
    await db.proposition.update({
      where: { id: row.id },
      data: { fullText: amended },
    });

    const [stored] = await db.$queryRaw<{ full_text_hash: string }[]>`
      SELECT full_text_hash FROM propositions WHERE id = ${row.id}
    `;

    // The whole point of a generated column over application hashing: sync
    // rewrites full_text in place, and a hash maintained by hand drifts the
    // moment someone adds a write site and forgets.
    expect(stored.full_text_hash).toBe(sha256(amended));
  });
});

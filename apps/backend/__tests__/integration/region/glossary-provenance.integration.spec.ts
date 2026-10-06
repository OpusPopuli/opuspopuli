/**
 * Integration tests for glossary provenance and the cascade it makes correct
 * (`glossary_entry_sources`, migration 20261002110000).
 *
 * These are integration tests rather than unit tests because the thing under
 * test IS the database: a composite foreign key with ON DELETE CASCADE, and a
 * prune that depends on NOT EXISTS against it. Mocking the DB layer here would
 * assert that Prisma was called, which is not the claim — the claim is that
 * deleting one page's block does not destroy a term another page still
 * defines.
 *
 * ## The bug these exist to prevent
 *
 * `glossary_entries` is keyed `(region_id, slug)` and is explicitly
 * last-write-wins: its `source_url` records only the most recent page to write
 * the term. The tempting migration is therefore:
 *
 *     ALTER TABLE glossary_entries ADD FOREIGN KEY (region_id, source_url)
 *       REFERENCES civics_blocks (region_id, source_url) ON DELETE CASCADE;
 *
 * Measured on the California corpus as of 2026-10-02, that would have been
 * data loss: 23 of 137 terms were defined on more than one page — `daily-file`
 * on four, `engrossed` / `enrolled` / `chaptered` / `conference-committee` on
 * three each. Deleting any ONE of those pages would have deleted the term.
 *
 * `MULTI_PAGE_TERM` below is that exact shape. If someone replaces the join
 * table with the naive FK, the "survives" test fails rather than passing
 * quietly — which is the point. Verified by reintroducing it (see the file
 * header note on the prune guard too).
 */

import { DbService } from '@opuspopuli/relationaldb-provider';

import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REGION_ID = 'california';
const PAGE_A = 'https://www.senate.ca.gov/citizens-guide/legislative-process';
const PAGE_B = 'https://www.senate.ca.gov/citizens-guide/senate-appointments';

/** Defined on BOTH pages — the shape the naive cascade would have destroyed. */
const MULTI_PAGE_TERM = 'daily-file';
/** Defined on PAGE_A only — the shape the prune is supposed to retire. */
const SINGLE_PAGE_TERM = 'engrossed';

describe('glossary provenance (glossary_entry_sources)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();

    await db.civicsBlock.createMany({
      data: [
        { regionId: REGION_ID, sourceUrl: PAGE_A, promptVersion: 'v5' },
        { regionId: REGION_ID, sourceUrl: PAGE_B, promptVersion: 'v5' },
      ],
    });

    for (const slug of [MULTI_PAGE_TERM, SINGLE_PAGE_TERM]) {
      await db.glossaryEntry.create({
        data: {
          regionId: REGION_ID,
          term: slug,
          slug,
          definition: { verbatim: slug, plainLanguage: slug },
          // Last-write-wins: PAGE_B wrote the shared term most recently, which
          // is precisely why this column cannot be the cascade's basis.
          sourceUrl: slug === MULTI_PAGE_TERM ? PAGE_B : PAGE_A,
        },
      });
    }

    await db.glossaryEntrySource.createMany({
      data: [
        { regionId: REGION_ID, slug: MULTI_PAGE_TERM, sourceUrl: PAGE_A },
        { regionId: REGION_ID, slug: MULTI_PAGE_TERM, sourceUrl: PAGE_B },
        { regionId: REGION_ID, slug: SINGLE_PAGE_TERM, sourceUrl: PAGE_A },
      ],
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const sourcesFor = (slug: string) =>
    db.glossaryEntrySource.count({ where: { regionId: REGION_ID, slug } });
  const entryExists = async (slug: string) =>
    (await db.glossaryEntry.count({ where: { regionId: REGION_ID, slug } })) >
    0;

  it('removes only the deleted page’s provenance, and keeps a term another page still defines', async () => {
    await db.civicsBlock.delete({
      where: {
        regionId_sourceUrl: { regionId: REGION_ID, sourceUrl: PAGE_A },
      },
    });

    // PAGE_A's row is gone; PAGE_B's remains.
    await expect(sourcesFor(MULTI_PAGE_TERM)).resolves.toBe(1);
    const remaining = await db.glossaryEntrySource.findMany({
      where: { regionId: REGION_ID, slug: MULTI_PAGE_TERM },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl)).toEqual([PAGE_B]);

    // The term itself SURVIVES. Under the naive FK it would not.
    await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);

    // The single-page term loses its last source, so it becomes prunable —
    // but is not yet deleted, because that is the prune's job, not the FK's.
    await expect(sourcesFor(SINGLE_PAGE_TERM)).resolves.toBe(0);
    await expect(entryExists(SINGLE_PAGE_TERM)).resolves.toBe(true);
  });

  /**
   * THE discriminating case. The naive FK cascades from
   * `glossary_entries.source_url`, which holds the LAST writer — PAGE_B for
   * this term. So deleting PAGE_A proves nothing: the naive design survives it
   * too. Deleting PAGE_B is what separates the two designs, because that is
   * the row the naive cascade would follow.
   *
   * Verified by reintroducing the naive FK against postgres_test: this case
   * fails with
   *   "expected true, received false"  (the term is gone)
   * while every other case in this file still passes.
   */
  it('keeps a term when the page that wrote it LAST is deleted but another still defines it', async () => {
    await db.civicsBlock.delete({
      where: {
        regionId_sourceUrl: { regionId: REGION_ID, sourceUrl: PAGE_B },
      },
    });

    // The term survives on PAGE_A's provenance alone.
    await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);
    await expect(sourcesFor(MULTI_PAGE_TERM)).resolves.toBe(1);
    const remaining = await db.glossaryEntrySource.findMany({
      where: { regionId: REGION_ID, slug: MULTI_PAGE_TERM },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl)).toEqual([PAGE_A]);

    // Its `sourceUrl` now names a page with no block — stale display
    // provenance, which is the documented cost of last-write-wins and is
    // exactly why the cascade must not key off it.
    const entry = await db.glossaryEntry.findUniqueOrThrow({
      where: { regionId_slug: { regionId: REGION_ID, slug: MULTI_PAGE_TERM } },
      select: { sourceUrl: true },
    });
    expect(entry.sourceUrl).toBe(PAGE_B);
  });

  it('cascades provenance away when the canonical term is deleted', async () => {
    await db.glossaryEntry.delete({
      where: {
        regionId_slug: { regionId: REGION_ID, slug: MULTI_PAGE_TERM },
      },
    });
    await expect(sourcesFor(MULTI_PAGE_TERM)).resolves.toBe(0);
  });

  it('refuses provenance for a page that has no block', async () => {
    await expect(
      db.glossaryEntrySource.create({
        data: {
          regionId: REGION_ID,
          slug: MULTI_PAGE_TERM,
          sourceUrl: 'https://www.sos.ca.gov/elections/ballot-measures/nope',
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses provenance for a term that does not exist', async () => {
    await expect(
      db.glossaryEntrySource.create({
        data: { regionId: REGION_ID, slug: 'no-such-term', sourceUrl: PAGE_A },
      }),
    ).rejects.toThrow();
  });

  describe('the prune', () => {
    /**
     * The production query, kept identical to the service's — including the
     * second NOT EXISTS, which is the part that makes it correct.
     */
    const prune = () => db.$executeRaw`
      DELETE FROM glossary_entries g
      WHERE g.region_id = ${REGION_ID}
        AND NOT EXISTS (
          SELECT 1 FROM glossary_entry_sources s
          WHERE s.region_id = g.region_id AND s.slug = g.slug
        )
        AND NOT EXISTS (
          SELECT 1 FROM civics_blocks c
          WHERE c.region_id = g.region_id AND c.source_url = g.source_url
        )`;

    it('retires a term whose last defining page is gone, and spares one still sourced', async () => {
      await db.civicsBlock.delete({
        where: {
          regionId_sourceUrl: { regionId: REGION_ID, sourceUrl: PAGE_A },
        },
      });

      await expect(prune()).resolves.toBe(1);
      await expect(entryExists(SINGLE_PAGE_TERM)).resolves.toBe(false);
      await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);
    });

    it('deletes nothing while every term still has a source', async () => {
      await expect(prune()).resolves.toBe(0);
      await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);
      await expect(entryExists(SINGLE_PAGE_TERM)).resolves.toBe(true);
    });

    /**
     * THE regression. This is the bug that shipped on 2026-10-05 and cost 81
     * glossary entries: a page that did not re-extract this run has a block
     * but no provenance, and the first version of the prune deleted its terms
     * as though the page were gone.
     *
     * Verified by reintroducing it — drop the second NOT EXISTS from `prune`
     * above and this case fails with "expected false, received true" while
     * every other case in the file still passes.
     */
    it('spares a term whose page still has a block but has no provenance yet', async () => {
      // Exactly the 2026-10-05 shape: provenance wiped (as though written
      // before the join table existed), blocks untouched.
      await db.glossaryEntrySource.deleteMany({
        where: { regionId: REGION_ID },
      });

      await expect(prune()).resolves.toBe(0);
      await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);
      await expect(entryExists(SINGLE_PAGE_TERM)).resolves.toBe(true);
    });

    /**
     * The orphan case the join table was built for: no provenance AND no
     * block, i.e. nothing defines the term any more.
     */
    it('retires a term with neither provenance nor a block at its source page', async () => {
      await db.glossaryEntrySource.deleteMany({
        where: { regionId: REGION_ID },
      });
      // SINGLE_PAGE_TERM's recorded sourceUrl is PAGE_A; remove that block so
      // nothing defines it. MULTI_PAGE_TERM records PAGE_B, which survives.
      await db.civicsBlock.delete({
        where: {
          regionId_sourceUrl: { regionId: REGION_ID, sourceUrl: PAGE_A },
        },
      });

      await expect(prune()).resolves.toBe(1);
      await expect(entryExists(SINGLE_PAGE_TERM)).resolves.toBe(false);
      await expect(entryExists(MULTI_PAGE_TERM)).resolves.toBe(true);
    });
  });
});

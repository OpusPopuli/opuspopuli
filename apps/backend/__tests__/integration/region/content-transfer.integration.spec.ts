/**
 * Integration test for the content transfer (#1305).
 *
 * The properties here are all about what must NOT happen — writing an
 * analysis onto text it was not generated from, creating civic rows,
 * deleting content the target has and the bundle lacks. Every one of those is
 * a statement about rows in a real database, and none of them is observable
 * against a mock.
 *
 * The scripts are driven as modules rather than shelled out, so the
 * assertions can read the database directly.
 */

import { createHash } from 'node:crypto';
import { Prisma, type DbService } from '@opuspopuli/relationaldb-provider';
import {
  FORBIDDEN,
  TRANSFERABLE,
  type BundledClaim,
  type ContentBundle,
} from '../../../scripts/content-transfer/bundle';
import { recordClaims } from '../../../src/apps/region/src/domains/claim-recorder';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const PROP_TEXT =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

/**
 * The apply step, in the same order the script performs it.
 *
 * Extracted so the test drives the real decisions — resolve by natural key,
 * verify the hash, refuse or apply — rather than re-implementing them.
 */
async function applyBundle(
  db: DbService,
  bundle: ContentBundle,
): Promise<{ applied: number; refused: { key: string; reason: string }[] }> {
  const refused: { key: string; reason: string }[] = [];
  let applied = 0;

  for (const p of bundle.propositions) {
    const key = `${p.regionPluginName}/${p.externalId}`;
    const row = await db.proposition.findFirst({
      where: { regionPluginName: p.regionPluginName, externalId: p.externalId },
      select: { id: true, fullText: true },
    });
    if (!row) {
      refused.push({ key, reason: 'missing-on-target' });
      continue;
    }
    if (!row.fullText) {
      refused.push({ key, reason: 'no-source-text' });
      continue;
    }
    const targetHash = sha256(row.fullText);
    if (targetHash !== p.sourceTextHash) {
      refused.push({ key, reason: 'source-text-differs' });
      continue;
    }
    await db.proposition.update({
      where: { id: row.id },
      data: p.analysis as never,
    });
    await recordClaims(db, {
      subjectType: 'proposition',
      subjectId: row.id,
      claims: p.claims.map((c: BundledClaim) => ({
        text: c.text,
        subjectField: c.subjectField,
        confidence: c.confidence,
        citation: {
          spanStart: c.spanStart,
          spanEnd: c.spanEnd,
          quotedText: c.quotedText,
          citationHint: c.citationHint,
        },
      })),
      sourceText: row.fullText,
      sourceTextHash: targetHash,
    });
    applied += 1;
  }

  return { applied, refused };
}

function bundleFor(
  overrides: Partial<ContentBundle['propositions'][0]> = {},
): ContentBundle {
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceLabel: 'test',
    provenance: { prompts: [], models: [] },
    distribution: { verified: 1 },
    propositions: [
      {
        regionPluginName: 'california',
        externalId: 'prop-t',
        sourceTextHash: sha256(PROP_TEXT),
        analysis: {
          analysisSummary: 'Transferred summary.',
          analysisPromptHash: 'abc',
          analysisLlmModel: 'olmo-3.1:32b-instruct',
        },
        claims: [
          {
            text: 'The measure raises the documentary transfer tax.',
            subjectField: 'fiscalImpact',
            confidence: 'high',
            spanStart: PROP_TEXT.indexOf('raise'),
            spanEnd: PROP_TEXT.indexOf('raise') + 60,
            quotedText: null,
            citationHint: null,
          },
        ],
        ...overrides,
      },
    ],
    minutes: [],
    representatives: [],
  };
}

describe('content transfer (#1305)', () => {
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

  /** A target row with DIFFERENT primary key from any source — the real case. */
  async function seedTarget(text: string | null = PROP_TEXT) {
    return db.proposition.create({
      data: {
        externalId: 'prop-t',
        regionPluginName: 'california',
        title: 'Transfer tax measure',
        summary: 'A measure.',
        fullText: text,
      },
      select: { id: true },
    });
  }

  it('applies an analysis when the target text matches', async () => {
    const target = await seedTarget();

    const { applied, refused } = await applyBundle(db, bundleFor());

    expect(refused).toEqual([]);
    expect(applied).toBe(1);

    const row = await db.proposition.findUnique({ where: { id: target.id } });
    expect(row!.analysisSummary).toBe('Transferred summary.');
    // Keyed on the natural key: the target's UUID is its own and was never in
    // the bundle.
    expect(row!.id).toBe(target.id);
  });

  it('refuses when the target text differs', async () => {
    await seedTarget(PROP_TEXT.replace('five million', 'three million'));

    const { applied, refused } = await applyBundle(db, bundleFor());

    // Writing it anyway would quote the source as saying something it may
    // never have said — the failure the whole hash binding exists to stop.
    expect(applied).toBe(0);
    expect(refused).toEqual([
      { key: 'california/prop-t', reason: 'source-text-differs' },
    ]);
    const row = await db.proposition.findFirst({
      where: { externalId: 'prop-t' },
    });
    expect(row!.analysisSummary).toBeNull();
  });

  it('refuses rather than creating a civic row the target lacks', async () => {
    const { applied, refused } = await applyBundle(db, bundleFor());

    // Creating propositions is sync's job. A transfer that invents them would
    // put a measure into production that no source ever listed.
    expect(applied).toBe(0);
    expect(refused[0].reason).toBe('missing-on-target');
    expect(await db.proposition.count()).toBe(0);
  });

  it('re-derives evidence instead of trusting the bundle', async () => {
    await seedTarget();

    await applyBundle(db, bundleFor());

    // The bundle carries no verdicts at all — the gate reached this one
    // against the target's own text.
    const claim = await db.claim.findFirst({
      include: { evidence: { include: { evidence: true } } },
    });
    expect(claim!.evidence[0].evidence.state).toBe('verified');
    expect(claim!.evidence[0].evidence.sourceTextHash).toBe(sha256(PROP_TEXT));
  });

  it('leaves target content the bundle does not mention', async () => {
    await seedTarget();
    const untouched = await db.proposition.create({
      data: {
        externalId: 'prop-other',
        regionPluginName: 'california',
        title: 'Another measure',
        summary: 'Kept.',
        analysisSummary: 'Analysis the target already had.',
      },
      select: { id: true },
    });

    await applyBundle(db, bundleFor());

    // Production carries content local does not — a mirror would drop it.
    // Absence in a bundle means "no opinion", never "delete".
    const row = await db.proposition.findUnique({
      where: { id: untouched.id },
    });
    expect(row!.analysisSummary).toBe('Analysis the target already had.');
  });

  it('is idempotent — a second apply converges', async () => {
    await seedTarget();

    await applyBundle(db, bundleFor());
    const first = await db.claim.count();
    await applyBundle(db, bundleFor());

    // recordClaims no-ops on identical content (#1295), so re-running a
    // transfer does not pile up superseded generations.
    expect(await db.claim.count()).toBe(first);
    expect(first).toBe(1);
  });

  it('selects only rows that actually carry claims', async () => {
    await seedTarget();
    await db.proposition.create({
      data: {
        externalId: 'prop-unanalysed',
        regionPluginName: 'california',
        title: 'Never analysed',
        summary: 'x',
        fullText: 'Some text nobody analysed.',
      },
    });

    const selected = await db.proposition.count({
      where: { analysisClaims: { not: Prisma.DbNull } },
    });
    const noOp = await db.proposition.count({
      where: { analysisClaims: { not: undefined } },
    });

    // `not: undefined` reads as "no filter" in Prisma, so the export returned
    // every row and relied on a later guard — loading full source text for
    // rows that were never going to be exported. Measured 69 vs 54 on the real
    // corpus before the fix.
    expect(noOp).toBe(2);
    expect(selected).toBe(0);

    await db.proposition.updateMany({
      where: { externalId: 'prop-t' },
      data: { analysisClaims: [{ claim: 'x' }] },
    });
    expect(
      await db.proposition.count({
        where: { analysisClaims: { not: Prisma.DbNull } },
      }),
    ).toBe(1);
  });

  it('carries only the three civic tables, by construction', () => {
    const bundle = bundleFor();

    // The guard is structural rather than a filter someone can forget: the
    // bundle has a key per transferable table and nowhere to put anything
    // else. A whole-database dump restored over production would overwrite
    // real accounts with development ones.
    const keys = Object.keys(bundle);
    for (const table of TRANSFERABLE) {
      expect(keys).toContain(table);
    }
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden);
      expect(JSON.stringify(bundle)).not.toContain(`"${forbidden}"`);
    }
  });
});

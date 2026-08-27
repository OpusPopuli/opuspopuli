/**
 * Backfill signal_profiles from legacy user_profiles columns (#1071).
 *
 * These tests execute the SHIPPED migration SQL rather than a reimplementation
 * of it, so the thing under test is the file that will run in production.
 *
 * Re-running the migration against seeded data is safe by construction: the
 * table create is IF NOT EXISTS, the insert is guarded by NOT EXISTS, and both
 * updates only touch null/empty targets. globalSetup has already applied it
 * once against an empty database, where it is a no-op.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  getDbService,
} from '../utils';

const MIGRATION_DIR = join(
  __dirname,
  '../../../../../packages/relationaldb-provider/prisma/migrations/20260826000000_backfill_signal_from_user_profile',
);

/**
 * Split the migration into statements, tracking single-quoted literals so a
 * semicolon inside one is not treated as a terminator.
 *
 * A naive `split(';')` guarded by a regex was the first attempt and was wrong:
 * `/'[^']*;[^']*'/` matches a CLOSING quote, then text containing a semicolon,
 * then an OPENING quote — which is every multi-statement file. Scan properly
 * rather than pattern-match.
 */
function statementsFrom(file: string): string[] {
  const raw = readFileSync(join(MIGRATION_DIR, file), 'utf8');
  const withoutComments = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let inLiteral = false;

  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    if (ch === "'") {
      // '' inside a literal is an escaped quote, not a terminator.
      if (inLiteral && withoutComments[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inLiteral = !inLiteral;
      current += ch;
      continue;
    }
    if (ch === ';' && !inLiteral) {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  statements.push(current);

  return statements
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function runSql(file: string): Promise<void> {
  const db = await getDbService();
  for (const statement of statementsFrom(file)) {
    await db.$executeRawUnsafe(statement);
  }
}

const runBackfill = () => runSql('migration.sql');
const runRollback = () => runSql('rollback.sql');

async function seedProfile(
  email: string,
  data: { homeownerStatus?: string; policyPriorities?: string[] },
) {
  const db = await getDbService();
  const user = await createUser({ email });
  await db.$executeRawUnsafe(
    `INSERT INTO "user_profiles" ("id", "user_id", "homeowner_status", "policy_priorities", "created_at", "updated_at")
     VALUES (gen_random_uuid()::TEXT, $1, $2::"HomeownerStatus", $3::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    user.id,
    data.homeownerStatus ?? null,
    data.policyPriorities ?? [],
  );
  return user;
}

async function signalFor(userId: string) {
  const db = await getDbService();
  const rows = await db.$queryRawUnsafe<
    { housing_tenure: string | null; interest_tags: string[] }[]
  >(
    `SELECT "housing_tenure", "interest_tags" FROM "signal_profiles" WHERE "user_id" = $1`,
    userId,
  );
  return rows[0];
}

async function createSignalRow(
  userId: string,
  data: { housingTenure?: string; interestTags?: string[] },
) {
  const db = await getDbService();
  // Every TEXT[] column is NOT NULL with no DB default (Prisma emits none for
  // `String[]`), so they must all be supplied — the same constraint the
  // migration's own INSERT has to satisfy.
  await db.$executeRawUnsafe(
    `INSERT INTO "signal_profiles" (
       "id", "user_id", "housing_tenure",
       "tax_exposure", "housing_flags", "children_age_bands", "vehicle_types",
       "special_licenses", "parent_of_student", "interest_tags",
       "trusted_organizations", "accessibility_needs",
       "created_at", "updated_at")
     VALUES (gen_random_uuid()::TEXT, $1, $2,
       ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       ARRAY[]::TEXT[], ARRAY[]::TEXT[], $3::TEXT[],
       ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    userId,
    data.housingTenure ?? null,
    data.interestTags ?? [],
  );
}

describe('Signal profile backfill (#1071)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('housing_tenure', () => {
    it('maps rent to renter and creates the missing signal row', async () => {
      const user = await seedProfile('backfill-rent@example.com', {
        homeownerStatus: 'rent',
      });

      await runBackfill();

      expect((await signalFor(user.id))?.housing_tenure).toBe('renter');
    });

    it('maps own to owner', async () => {
      const user = await seedProfile('backfill-own@example.com', {
        homeownerStatus: 'own',
      });

      await runBackfill();

      expect((await signalFor(user.id))?.housing_tenure).toBe('owner');
    });

    /**
     * Living with family is neither renter nor owner. Coercing it would produce
     * a wrong ranking flag; isRenter=false / isHomeowner=false is correct.
     */
    it.each(['living_with_family', 'other', 'prefer_not_to_say'])(
      'drops %s rather than coercing it, and creates no signal row',
      async (status) => {
        const user = await seedProfile(`backfill-${status}@example.com`, {
          homeownerStatus: status,
        });

        await runBackfill();

        expect(await signalFor(user.id)).toBeUndefined();
      },
    );

    it('never overwrites an existing Your Model answer', async () => {
      const user = await seedProfile('backfill-conflict@example.com', {
        homeownerStatus: 'own',
      });
      await createSignalRow(user.id, { housingTenure: 'renter' });

      await runBackfill();

      // Your Model wins on conflict (plan decision 2).
      expect((await signalFor(user.id))?.housing_tenure).toBe('renter');
    });
  });

  describe('interest_tags', () => {
    it('carries the seven mappable values and renames criminal_justice', async () => {
      const user = await seedProfile('backfill-tags@example.com', {
        policyPriorities: [
          'healthcare',
          'education',
          'environment',
          'immigration',
          'taxes',
          'housing',
          'criminal_justice',
        ],
      });

      await runBackfill();

      expect((await signalFor(user.id))?.interest_tags.sort()).toEqual(
        [
          'education',
          'environment',
          'healthcare',
          'housing',
          'immigration',
          'justice',
          'taxes',
        ].sort(),
      );
    });

    /**
     * 13 of 20 values have no interestTags target. The loss is accepted
     * (#1071) but must be a clean drop, never a coercion into a neighbouring
     * tag — several are politically salient.
     */
    it('drops the thirteen unmappable values without inventing tags', async () => {
      const user = await seedProfile('backfill-unmappable@example.com', {
        policyPriorities: [
          'economy',
          'gun_rights',
          'gun_control',
          'social_security',
          'infrastructure',
          'national_security',
          'civil_rights',
          'womens_rights',
          'lgbtq_rights',
          'veterans_affairs',
          'labor_unions',
          'small_business',
          'agriculture',
        ],
      });

      await runBackfill();

      // Nothing mappable, so no signal row should be created at all.
      expect(await signalFor(user.id)).toBeUndefined();
    });

    it('keeps only the mappable subset from a mixed list', async () => {
      const user = await seedProfile('backfill-mixed@example.com', {
        policyPriorities: ['housing', 'gun_rights', 'taxes', 'agriculture'],
      });

      await runBackfill();

      expect((await signalFor(user.id))?.interest_tags.sort()).toEqual([
        'housing',
        'taxes',
      ]);
    });

    it('never overwrites existing tags', async () => {
      const user = await seedProfile('backfill-tag-conflict@example.com', {
        policyPriorities: ['healthcare', 'taxes'],
      });
      await createSignalRow(user.id, { interestTags: ['transit'] });

      await runBackfill();

      expect((await signalFor(user.id))?.interest_tags).toEqual(['transit']);
    });
  });

  describe('idempotence and provenance', () => {
    it('is safe to run twice', async () => {
      const user = await seedProfile('backfill-twice@example.com', {
        homeownerStatus: 'rent',
        policyPriorities: ['housing'],
      });

      await runBackfill();
      await runBackfill();

      const db = await getDbService();
      const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::BIGINT AS count FROM "signal_profiles" WHERE "user_id" = $1`,
        user.id,
      );
      expect(Number(rows[0].count)).toBe(1);
      expect((await signalFor(user.id))?.housing_tenure).toBe('renter');
    });

    it('records provenance only for fields it actually wrote', async () => {
      const user = await seedProfile('backfill-provenance@example.com', {
        homeownerStatus: 'rent',
      });

      await runBackfill();

      const db = await getDbService();
      const rows = await db.$queryRawUnsafe<{ field: string }[]>(
        `SELECT "field" FROM "_backfill_1071_signal_writes" WHERE "user_id" = $1`,
        user.id,
      );
      expect(rows.map((r) => r.field)).toEqual(['housing_tenure']);
    });

    /**
     * The provenance table must never hold field VALUES — the source values
     * still live in user_profiles until the step-6 cleanup, so a second copy
     * of personal information would be gratuitous.
     */
    it('stores no field values in the provenance table', async () => {
      const db = await getDbService();
      const cols = await db.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT "column_name" FROM information_schema.columns
          WHERE table_name = '_backfill_1071_signal_writes'`,
      );
      expect(cols.map((c) => c.column_name).sort()).toEqual([
        'field',
        'user_id',
      ]);
    });
  });

  describe('rollback', () => {
    it('reverts exactly what the backfill wrote', async () => {
      const user = await seedProfile('backfill-rollback@example.com', {
        homeownerStatus: 'rent',
        policyPriorities: ['housing'],
      });

      await runBackfill();
      expect((await signalFor(user.id))?.housing_tenure).toBe('renter');

      await runRollback();

      // The row existed only because of the backfill, so it is removed.
      expect(await signalFor(user.id)).toBeUndefined();
    });

    it('preserves a signal row that held real Your Model data', async () => {
      const user = await seedProfile('backfill-rollback-keep@example.com', {
        policyPriorities: ['housing'],
      });
      await createSignalRow(user.id, { housingTenure: 'owner' });

      await runBackfill();
      await runRollback();

      const signal = await signalFor(user.id);
      expect(signal).toBeDefined();
      expect(signal?.housing_tenure).toBe('owner');
      expect(signal?.interest_tags).toEqual([]);
    });
  });
});

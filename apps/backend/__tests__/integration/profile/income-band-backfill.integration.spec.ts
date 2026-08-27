/**
 * Income backfill: UserProfile.incomeRange -> SensitiveProfile.incomeBand
 * (#1071, plan subtask 2).
 *
 * Exercises the real encryption path via SensitiveProfileService rather than
 * mocking it — the whole risk of this backfill is that it decrypts, amends and
 * re-encrypts live personal data, so a mocked crypto layer would test nothing
 * that matters.
 *
 * The script's own bootstrap (NestFactory + env flags) is not under test; the
 * decision logic it calls is, via the same service the script uses.
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  cleanDatabase,
  disconnectDatabase,
  createUser,
  getDbService,
} from '../utils';
import { EncryptionService } from '../../../src/apps/users/src/domains/personalization/encryption.service';
import { SensitiveProfileService } from '../../../src/apps/users/src/domains/personalization/sensitive-profile.service';
import { decideAndApply } from '../../../src/apps/users/src/scripts/backfill-income-band.logic';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Mirrors INCOME_BAND_BY_RANGE in
 * src/apps/users/src/scripts/backfill-income-band.ts. Kept in the test as a
 * literal so a change to the script's map has to be made deliberately in two
 * places rather than silently agreeing with itself.
 */
const INCOME_BAND_BY_RANGE: Record<string, string> = {
  under_25k: 'under_25k',
  '25k_50k': '25k_50k',
  '50k_75k': '50k_75k',
  '75k_100k': '75k_100k',
  '100k_150k': '100k_150k',
  '150k_200k': '150k_200k',
  over_200k: 'over_200k',
};

let sensitive: SensitiveProfileService;

/**
 * Delegates to the SHIPPED decision function. An earlier version of this spec
 * re-implemented the rules inline, which meant the tests would keep passing if
 * the script drifted — the same mistake the SQL spec avoids by executing the
 * real migration file.
 */
const backfillOne = (userId: string, incomeRange: string | null) =>
  decideAndApply(userId, incomeRange, sensitive);

async function seedIncomeRange(email: string, incomeRange: string | null) {
  const db = await getDbService();
  const user = await createUser({ email });
  await db.$executeRawUnsafe(
    `INSERT INTO "user_profiles" ("id", "user_id", "income_range", "policy_priorities", "created_at", "updated_at")
     VALUES (gen_random_uuid()::TEXT, $1, $2::"IncomeRange", ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    user.id,
    incomeRange,
  );
  return user;
}

describe('Income band backfill (#1071)', () => {
  beforeAll(async () => {
    // A deterministic, obviously-fake 32-byte key. Real AES-256-GCM still runs
    // — only the key material is test-owned, so the round-trip under test is
    // the production one. No Vault dependency, matching how the unit spec and
    // local dev resolve the key from env.
    const testKey = Buffer.alloc(32, 7).toString('base64');

    const moduleRef = await Test.createTestingModule({
      providers: [
        EncryptionService,
        SensitiveProfileService,
        { provide: DbService, useFactory: () => getDbService() },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === 'SENSITIVE_PROFILE_ENCRYPTION_KEY' ? testKey : undefined,
          },
        },
      ],
    }).compile();

    await moduleRef.init();
    sensitive = moduleRef.get(SensitiveProfileService);
    await moduleRef.get(EncryptionService).onModuleInit();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it.each(Object.entries(INCOME_BAND_BY_RANGE))(
    'carries %s across as %s, round-tripping through real encryption',
    async (range, expected) => {
      const user = await seedIncomeRange(`income-${range}@example.com`, range);

      expect(await backfillOne(user.id, range)).toBe('written');

      const state = await sensitive.getState(user.id);
      expect(state.payload?.incomeBand).toBe(expected);
    },
  );

  /**
   * prefer_not_to_say is a refusal, not an answer. Carrying it across would
   * turn "I decline to say" into a stored T3 value.
   */
  it('drops prefer_not_to_say rather than storing it', async () => {
    const user = await seedIncomeRange(
      'income-decline@example.com',
      'prefer_not_to_say',
    );

    expect(await backfillOne(user.id, 'prefer_not_to_say')).toBe('unmappable');
    expect(
      (await sensitive.getState(user.id)).payload?.incomeBand,
    ).toBeUndefined();
  });

  /**
   * The highest-consequence rule here. A user who turned on no-fields-mode has
   * explicitly asked that nothing be stored in their T3 payload; a backfill
   * must not quietly populate it behind that toggle.
   */
  it('writes nothing for a user with noFieldsMode on', async () => {
    const user = await seedIncomeRange(
      'income-nofields@example.com',
      '50k_75k',
    );
    await sensitive.setNoFieldsMode(user.id, true);

    expect(await backfillOne(user.id, '50k_75k')).toBe('noFieldsMode');

    // Prove it at the storage layer, not just through the read API — the read
    // masks when noFieldsMode is on, so it could hide a write that did happen.
    const db = await getDbService();
    const rows = await db.$queryRawUnsafe<
      { encrypted_payload: Buffer | null }[]
    >(
      `SELECT "encrypted_payload" FROM "sensitive_profiles" WHERE "user_id" = $1`,
      user.id,
    );
    expect(rows[0]?.encrypted_payload ?? null).toBeNull();
  });

  it('never overwrites an incomeBand the user already set', async () => {
    const user = await seedIncomeRange(
      'income-conflict@example.com',
      'under_25k',
    );
    await sensitive.updatePayload(user.id, { incomeBand: 'over_200k' });

    expect(await backfillOne(user.id, 'under_25k')).toBe('alreadySet');
    expect((await sensitive.getState(user.id)).payload?.incomeBand).toBe(
      'over_200k',
    );
  });

  it('preserves other T3 fields already in the payload', async () => {
    const user = await seedIncomeRange(
      'income-preserve@example.com',
      '75k_100k',
    );
    await sensitive.updatePayload(user.id, { veteranStatus: 'veteran' });

    expect(await backfillOne(user.id, '75k_100k')).toBe('written');

    const payload = (await sensitive.getState(user.id)).payload;
    expect(payload?.incomeBand).toBe('75k_100k');
    expect(payload?.veteranStatus).toBe('veteran');
  });

  it('is idempotent — a second pass writes nothing', async () => {
    const user = await seedIncomeRange('income-twice@example.com', '100k_150k');

    expect(await backfillOne(user.id, '100k_150k')).toBe('written');
    expect(await backfillOne(user.id, '100k_150k')).toBe('alreadySet');
    expect((await sensitive.getState(user.id)).payload?.incomeBand).toBe(
      '100k_150k',
    );
  });

  /**
   * The payload must be genuinely encrypted at rest — if this ever stored
   * readable JSON, every guarantee above would be cosmetic.
   */
  it('stores the band as ciphertext, not readable text', async () => {
    const user = await seedIncomeRange(
      'income-cipher@example.com',
      'over_200k',
    );
    await backfillOne(user.id, 'over_200k');

    const db = await getDbService();
    const rows = await db.$queryRawUnsafe<
      { encrypted_payload: Buffer; encryption_iv: Buffer | null }[]
    >(
      `SELECT "encrypted_payload", "encryption_iv" FROM "sensitive_profiles" WHERE "user_id" = $1`,
      user.id,
    );

    expect(rows[0].encryption_iv).not.toBeNull();
    expect(rows[0].encrypted_payload.toString('utf8')).not.toContain(
      'over_200k',
    );
    expect(rows[0].encrypted_payload.toString('utf8')).not.toContain(
      'incomeBand',
    );
  });
});

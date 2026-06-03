import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Singleton DbService instance for integration tests.
 * Uses the same DATABASE_URL as the running services.
 */
let dbInstance: DbService | null = null;

/**
 * Gets or creates a DbService instance for integration tests.
 * The instance is reused across tests for efficiency.
 */
export async function getDbService(): Promise<DbService> {
  if (!dbInstance) {
    dbInstance = new DbService();
    await dbInstance.$connect();
  }
  return dbInstance;
}

/**
 * Cleans all data from the database.
 * Should be called in beforeEach() to ensure test isolation.
 *
 * Refuses to run unless DATABASE_URL points at a `*_test` database — this
 * is the safety primitive for OpusPopuli/opuspopuli#796. Before this guard
 * existed, every `pnpm test:integration` run wiped the dev DB (~30 min
 * recovery loop per run). If the guard fires unexpectedly, check
 * `apps/backend/.env`'s `INTEGRATION_DATABASE_URL` and that
 * `globalSetup` is swapping `DATABASE_URL` to it — do NOT remove the
 * guard.
 *
 * @example
 * ```typescript
 * describe('User tests', () => {
 *   beforeEach(async () => {
 *     await cleanDatabase();
 *   });
 *
 *   it('should create a user', async () => {
 *     // Test with clean database state
 *   });
 * });
 * ```
 */
export async function cleanDatabase(): Promise<void> {
  assertTestDatabase();
  const db = await getDbService();
  await db.cleanDatabase();
}

/**
 * Throws if the in-process DATABASE_URL doesn't end in a `_test` database
 * name. Belt-and-suspenders against accidentally pointing the integration
 * suite at the dev DB. Exported so callers that go around cleanDatabase()
 * (e.g. raw db.bill.deleteMany in a future test) can opt into the same
 * guard.
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  // `_test` followed by start-of-query, fragment, trailing slash, or end of
  // string. Trailing slash isn't valid Postgres, but tolerating it makes
  // the guard robust against URL-builder noise.
  if (!url || !/\/[A-Za-z0-9_]*_test([?#/]|$)/.test(url)) {
    throw new Error(
      `cleanDatabase() refused: DATABASE_URL must point at a *_test database. ` +
        `Got: ${url ?? '<unset>'}. ` +
        `This guard protects the dev DB — see OpusPopuli/opuspopuli#796.`,
    );
  }
}

/**
 * Disconnects the database connection.
 * Should be called in afterAll() at the test suite level.
 *
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await disconnectDatabase();
 * });
 * ```
 */
export async function disconnectDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.$disconnect();
    dbInstance = null;
  }
}

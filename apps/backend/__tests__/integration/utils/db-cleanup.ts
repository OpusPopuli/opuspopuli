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
  const db = await getDbService();
  await db.cleanDatabase();
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

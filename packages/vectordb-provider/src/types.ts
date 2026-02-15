/**
 * Minimal interface for raw SQL query execution.
 * Compatible with PrismaClient.$queryRawUnsafe / $executeRawUnsafe.
 * This keeps vectordb-provider decoupled from @prisma/client as a direct dependency.
 */
export interface IRawQueryClient {
  /**
   * Execute a raw SQL query that returns rows (SELECT).
   * Parameters use positional placeholders ($1, $2, etc.).
   */
  $queryRawUnsafe<T = unknown>(
    query: string,
    ...values: unknown[]
  ): Promise<T[]>;

  /**
   * Execute a raw SQL statement that does not return rows (INSERT, UPDATE, DELETE, DDL).
   * Parameters use positional placeholders ($1, $2, etc.).
   */
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/**
 * Batch Transaction Utility
 *
 * Chunks Prisma batch operations into smaller transactions to prevent
 * timeouts and memory pressure with large datasets.
 * See issue #476.
 */

/** Minimal interface satisfied by Prisma's $transaction method */
interface TransactionClient {
  $transaction(operations: unknown[]): Promise<unknown[]>;
}

const DEFAULT_CHUNK_SIZE = 500;

/**
 * Execute Prisma operations in batched transactions.
 *
 * Splits an array of PrismaPromise operations into chunks and runs each
 * chunk in its own $transaction call. This prevents timeouts when syncing
 * large datasets (e.g., thousands of upserts).
 *
 * @param db - Prisma client (or any object with $transaction)
 * @param operations - Array of PrismaPromise operations
 * @param chunkSize - Max operations per transaction (default: 500)
 */
export async function batchTransaction(
  db: TransactionClient,
  operations: unknown[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<void> {
  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    await db.$transaction(chunk);
  }
}

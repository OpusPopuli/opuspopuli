import { DbService } from "./db.service.js";

/**
 * Reads the declared width of a pgvector column, or null if it is not there.
 *
 * `atttypmod` carries the dimension directly for pgvector — verified against
 * live databases at both widths — unlike varchar, where it is length + 4.
 *
 * Returns null rather than throwing when the table or column is absent: that
 * is the state of a database whose migrations have not run yet, and a service
 * must be able to start against one to run them.
 */
export async function readVectorColumnWidth(
  db: DbService,
  table: string,
  column: string,
): Promise<number | null> {
  const rows = await db.$queryRaw<{ width: number | null }[]>`
    SELECT a.atttypmod AS width
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${`public.${table}`})
      AND a.attname = ${column}
      AND NOT a.attisdropped
  `;

  const width = rows[0]?.width;
  // pgvector writes -1 for a column declared without a dimension.
  return typeof width === "number" && width > 0 ? width : null;
}

/**
 * Fail at boot when the running provider, the shared constant, and the actual
 * database column do not all agree on embedding width.
 *
 * ── Why three-way and not two ────────────────────────────────────────────
 *
 * The original assertion compared the provider to `EMBEDDING_DIMENSIONS` only.
 * That catches a misconfigured provider, and misses the failure that actually
 * happens during a width migration: an old image (provider 384, constant 384)
 * deployed against an already-widened 768 column agrees with itself perfectly
 * and boots. Every write then throws `expected 768 dimensions, not 384`, once
 * per row, and every similarity query throws `different vector dimensions` —
 * so embeddings quietly stop being written while the service reports healthy.
 *
 * Reading the column closes that gap: the deploy window becomes a service that
 * refuses to start, which is how the rest of this codebase fails.
 *
 * A missing column is NOT an error. A service has to be able to boot against a
 * database whose migrations have not been applied yet — that is how they get
 * applied.
 */
export async function assertVectorColumnWidth(
  db: DbService,
  table: string,
  column: string,
  expected: number,
): Promise<void> {
  const actual = await readVectorColumnWidth(db, table, column);

  if (actual !== null && actual !== expected) {
    throw new Error(
      `${table}.${column} is vector(${actual}) but this build expects ` +
        `vector(${expected}). The embedding width migration and the image ` +
        `that sets EMBEDDING_DIMENSIONS must deploy together — see ` +
        `20260911180000_embeddings_768_cutover and EMBEDDING_DIMENSIONS in ` +
        `@opuspopuli/common.`,
    );
  }
}

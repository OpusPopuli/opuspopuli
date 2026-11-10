/**
 * Swap the staged corpus into place (#1439, step 3 of 3 — in the window).
 *
 * One transaction. Every check that can refuse runs inside it, as an
 * exception that aborts it, so the only outcomes are "swapped and verified"
 * and "exactly as before". The heavy work was done by `stage`; this is DDL,
 * the re-pointing of a few user references, and counts.
 *
 * Inside the transaction, in order:
 *   1. Lock every table it touches, failing fast rather than waiting.
 *   2. Count every user table.
 *   3. Build the remaps of user references into the corpus, by natural key.
 *      Any foreign-key reference without a match refuses (plan §3).
 *   4. Empty the per-user caches.
 *   5. Record every foreign key from a non-civic table into a civic one.
 *   6. Drop the live civic tables, and assert that dropped only those keys.
 *   7. Move the staged tables into `public`.
 *   8. Re-point the user references.
 *   9. Recreate the recorded keys verbatim, which validates them.
 *  10. Assert user counts unchanged, civic counts as the manifest says,
 *      the staging schema empty — then drop it.
 *
 * Usage (from apps/backend):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/corpus-transfer/swap.ts --target-db postgres \
 *     --manifest <dir>/corpus-<ts>.dump.manifest.json \
 *     [--rehearse | --apply] [--lock-timeout 5s]
 *     [--container opuspopuli-db | --local]
 *
 * With neither flag it runs the pre-checks only. `--rehearse` runs the whole
 * transaction and rolls it back: it takes the same locks, so stop writers
 * first. Exit codes: 0 done, 2 refused, 1 error.
 *
 * Plan of record: docs/plans/1439-corpus-transfer.md §4.3.
 */
import {
  dependencyProblems,
  diffCatalogs,
  readCatalog,
  schemaExists,
} from './catalog';
import { inspectSource } from './export';
import { STAGING_SCHEMA, type CorpusManifest } from './manifest';
import {
  RefusalError,
  containerPg,
  ident,
  literal,
  localPg,
  type PgRunner,
} from './pg';
import { migrationDifferences, readManifest } from './stage';
import {
  CACHE_TABLES,
  CIVIC_TABLES,
  REMAPPED_REFERENCES,
  SOFT_REFERENCES,
  USER_TABLES,
  type RemappedReference,
} from './tables';

export type SwapMode = 'check' | 'rehearse' | 'apply';

export interface SwapReport {
  remapped: Record<string, number>;
  softUnmatched: Record<string, number>;
  cachesEmptied: Record<string, number>;
  foreignKeysRecreated: number;
  userTablesChecked: number;
  civicTablesChecked: number;
}

export interface SwapResult {
  mode: SwapMode;
  committed: boolean;
  report?: SwapReport;
}

const S = ident(STAGING_SCHEMA);
const pub = (t: string) => `public.${ident(t)}`;
const staged = (t: string) => `${S}.${ident(t)}`;
const textArray = (items: readonly string[]) =>
  `ARRAY[${items.map(literal).join(', ')}]::text[]`;

/** Abort the transaction with `message` (a format string over `args`) if `condition`. */
export function refuseIf(
  condition: string,
  message: string,
  ...args: string[]
): string {
  const params = args.length ? `, ${args.join(', ')}` : '';
  return `DO $$ BEGIN
  IF ${condition} THEN
    RAISE EXCEPTION ${literal(`refused: ${message}`)}${params};
  END IF;
END $$;`;
}

const refKey = (r: RemappedReference) => `${r.table}.${r.column}`;
const remapTable = (r: RemappedReference) =>
  ident(`swap_remap_${r.table}_${r.column}`.slice(0, 63));

/**
 * Old live ID → new staged ID for every corpus row a user row references.
 * Natural keys are tried in order; each is unique on the target, so a match
 * is at most one row.
 */
export function remapSql(r: RemappedReference): string {
  const joins = r.naturalKeys.map((key, i) => {
    const on = key
      .map((c) => `k${i}.${ident(c)} = l.${ident(c)}`)
      .join(' AND ');
    return `LEFT JOIN ${staged(r.target)} k${i} ON ${on}`;
  });
  const newId = `COALESCE(${r.naturalKeys.map((_, i) => `k${i}.id`).join(', ')})`;
  return `CREATE TEMP TABLE ${remapTable(r)} ON COMMIT DROP AS
SELECT l.id AS old_id, ${newId} AS new_id
FROM ${pub(r.target)} l
${joins.join('\n')}
WHERE l.id IN (SELECT ${ident(r.column)} FROM ${pub(r.table)} WHERE ${ident(r.column)} IS NOT NULL);`;
}

/**
 * Refuse a remap that would collide with itself mid-update: one row moving
 * to an ID another row is moving away from. Random IDs from two databases
 * should never do this; the check makes "should" into "does not".
 */
function noChainsSql(r: RemappedReference): string {
  const m = remapTable(r);
  return refuseIf(
    `EXISTS (SELECT 1 FROM ${m} a JOIN ${m} b ON a.new_id = b.old_id AND a.old_id <> b.old_id)`,
    `${refKey(r)} remap would chain one ID into another`,
  );
}

function applyRemapSql(r: RemappedReference): string {
  return `UPDATE ${pub(r.table)} t SET ${ident(r.column)} = m.new_id
FROM ${remapTable(r)} m
WHERE t.${ident(r.column)} = m.old_id AND m.new_id IS NOT NULL AND m.new_id <> m.old_id;`;
}

/** User rows whose reference finds nothing in the staged corpus. */
function unmatchedSql(r: RemappedReference): string {
  return `(SELECT count(*) FROM ${pub(r.table)} t
  WHERE t.${ident(r.column)} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ${remapTable(r)} m
                    WHERE m.old_id = t.${ident(r.column)} AND m.new_id IS NOT NULL))`;
}

function countsTableSql(name: string, tables: readonly string[]): string {
  return `CREATE TEMP TABLE ${ident(name)} ON COMMIT DROP AS
${tables.map((t) => `SELECT ${literal(t)}::text AS t, count(*) AS n FROM ${pub(t)}`).join('\nUNION ALL\n')};`;
}

const FKS_INTO_CIVIC = `
FROM pg_catalog.pg_constraint co
JOIN pg_catalog.pg_class c ON c.oid = co.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_class f ON f.oid = co.confrelid
JOIN pg_catalog.pg_namespace fn ON fn.oid = f.relnamespace
WHERE co.contype = 'f' AND n.nspname = 'public' AND fn.nspname = 'public'
  AND f.relname = ANY(${textArray(CIVIC_TABLES)})
  AND NOT c.relname = ANY(${textArray(CIVIC_TABLES)})`;

const NON_CIVIC_CONSTRAINTS = `(SELECT count(*) FROM pg_catalog.pg_constraint co
  JOIN pg_catalog.pg_class c ON c.oid = co.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT c.relname = ANY(${textArray(CIVIC_TABLES)}))`;

const NON_CIVIC_TABLES = `(SELECT count(*) FROM pg_catalog.pg_tables
  WHERE schemaname = 'public' AND NOT tablename = ANY(${textArray(CIVIC_TABLES)}))`;

function lockSql(userTables: readonly string[]): string {
  const tables = [
    ...CIVIC_TABLES.map(pub),
    ...CIVIC_TABLES.map(staged),
    ...CACHE_TABLES.map(pub),
    ...userTables.map(pub),
  ];
  return `LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE;`;
}

function cachesSql(): string[] {
  return [
    countsTableSql('swap_caches', CACHE_TABLES),
    `TRUNCATE ${CACHE_TABLES.map(pub).join(', ')};`,
  ];
}

function dropAndMoveSql(): string[] {
  return [
    `CREATE TEMP TABLE swap_fks ON COMMIT DROP AS
SELECT co.conrelid::pg_catalog.regclass::text AS rel, co.conname::text AS name,
       pg_catalog.pg_get_constraintdef(co.oid) AS def${FKS_INTO_CIVIC};`,
    `CREATE TEMP TABLE swap_shape ON COMMIT DROP AS
SELECT ${NON_CIVIC_CONSTRAINTS} AS constraints, ${NON_CIVIC_TABLES} AS tables;`,
    `DROP TABLE ${CIVIC_TABLES.map(pub).join(', ')} CASCADE;`,
    // CASCADE here may drop the recorded foreign keys and nothing else.
    // The dependency check said so before the transaction; this proves it.
    refuseIf(
      `(SELECT tables FROM swap_shape) <> ${NON_CIVIC_TABLES}
    OR (SELECT constraints FROM swap_shape) - (SELECT count(*) FROM swap_fks) <> ${NON_CIVIC_CONSTRAINTS}`,
      'dropping the live corpus would have dropped more than its incoming foreign keys',
    ),
    ...CIVIC_TABLES.map((t) => `ALTER TABLE ${staged(t)} SET SCHEMA public;`),
  ];
}

const RECREATE_FKS = `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rel, name, def FROM swap_fks ORDER BY rel, name LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.rel, r.name, r.def);
  END LOOP;
END $$;`;

function finalChecksSql(manifest: CorpusManifest): string[] {
  const expected = Object.entries(manifest.tables)
    .map(([t, n]) => `(${literal(t)}, ${Number(n)})`)
    .join(', ');
  return [
    refuseIf(
      `(SELECT count(*) FROM (SELECT rel, name, def FROM swap_fks
         EXCEPT SELECT co.conrelid::pg_catalog.regclass::text, co.conname::text,
                       pg_catalog.pg_get_constraintdef(co.oid)${FKS_INTO_CIVIC}) x) > 0`,
      'a foreign key into the corpus was not recreated as it was',
    ),
    refuseIf(
      `EXISTS (SELECT 1 FROM swap_users_before b JOIN swap_users_after a USING (t) WHERE a.n <> b.n)`,
      'user table counts changed: %',
      `(SELECT string_agg(t, ', ') FROM swap_users_before b JOIN swap_users_after a USING (t) WHERE a.n <> b.n)`,
    ),
    `CREATE TEMP TABLE swap_expected (t text, n bigint) ON COMMIT DROP;
INSERT INTO swap_expected VALUES ${expected};`,
    countsTableSql('swap_civic_after', CIVIC_TABLES),
    refuseIf(
      `EXISTS (SELECT 1 FROM swap_expected e LEFT JOIN swap_civic_after a USING (t) WHERE a.n IS DISTINCT FROM e.n)
    OR (SELECT count(*) FROM swap_expected) <> ${CIVIC_TABLES.length}`,
      'civic counts differ from the manifest: %',
      `(SELECT string_agg(t, ', ') FROM swap_expected e LEFT JOIN swap_civic_after a USING (t) WHERE a.n IS DISTINCT FROM e.n)`,
    ),
    refuseIf(
      `EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${literal(STAGING_SCHEMA)})`,
      `${STAGING_SCHEMA} still holds objects after the move`,
    ),
    `DROP SCHEMA ${S} RESTRICT;`,
  ];
}

function reportSql(): string {
  const remapped = REMAPPED_REFERENCES.concat(SOFT_REFERENCES)
    .map(
      (r) =>
        `${literal(refKey(r))}, (SELECT count(*) FROM ${remapTable(r)} WHERE new_id IS NOT NULL AND new_id <> old_id)`,
    )
    .join(', ');
  return `SELECT json_build_object(
  'remapped', json_build_object(${remapped}),
  'softUnmatched', (SELECT json_object_agg(ref, n) FROM swap_soft_unmatched),
  'cachesEmptied', (SELECT json_object_agg(t, n) FROM swap_caches),
  'foreignKeysRecreated', (SELECT count(*) FROM swap_fks),
  'userTablesChecked', (SELECT count(*) FROM swap_users_after),
  'civicTablesChecked', (SELECT count(*) FROM swap_civic_after)
)::text;`;
}

/**
 * The whole swap as one script. `userTables` are the user tables that exist
 * on the target (the vector table is created at boot, so may not).
 */
export function swapSql(options: {
  manifest: CorpusManifest;
  userTables: readonly string[];
  lockTimeout: string;
  commit: boolean;
}): string {
  const hard = REMAPPED_REFERENCES.flatMap((r) => [
    remapSql(r),
    refuseIf(
      `${unmatchedSql(r)} > 0`,
      `% ${refKey(r)} reference(s) find no match in the staged corpus`,
      unmatchedSql(r),
    ),
    noChainsSql(r),
  ]);
  const soft = [
    ...SOFT_REFERENCES.flatMap((r) => [remapSql(r), noChainsSql(r)]),
    // Counted now: once re-pointed, a matched reference no longer holds the
    // old ID its remap row is keyed by, and would count as unmatched.
    `CREATE TEMP TABLE swap_soft_unmatched ON COMMIT DROP AS
${SOFT_REFERENCES.map((r) => `SELECT ${literal(refKey(r))}::text AS ref, ${unmatchedSql(r)} AS n`).join('\nUNION ALL\n')};`,
  ];
  const remapped = [...REMAPPED_REFERENCES, ...SOFT_REFERENCES];
  return [
    'BEGIN;',
    `SET LOCAL lock_timeout = ${literal(options.lockTimeout)};`,
    `SET LOCAL search_path = '';`,
    lockSql(options.userTables),
    countsTableSql('swap_users_before', options.userTables),
    ...hard,
    ...soft,
    ...cachesSql(),
    ...dropAndMoveSql(),
    ...remapped.map(applyRemapSql),
    RECREATE_FKS,
    countsTableSql('swap_users_after', options.userTables),
    ...finalChecksSql(options.manifest),
    reportSql(),
    options.commit ? 'COMMIT;' : 'ROLLBACK;',
  ].join('\n');
}

/** Everything that can be checked without taking a lock. */
async function preflight(
  pg: PgRunner,
  db: string,
  manifest: CorpusManifest,
): Promise<string[]> {
  const target = await inspectSource(pg, db);
  const migrations = migrationDifferences(
    manifest.migrations,
    target.migrations,
  );
  if (migrations.length > 0) {
    throw new RefusalError(`migrations differ: ${migrations.join('; ')}`);
  }
  if (!(await schemaExists(pg, db, STAGING_SCHEMA))) {
    throw new RefusalError(`nothing staged: ${STAGING_SCHEMA} does not exist`);
  }
  const dependencies = await dependencyProblems(pg, db);
  if (dependencies.length > 0) {
    throw new RefusalError(
      `objects a swap would break: ${dependencies.join('; ')}`,
    );
  }
  const [live, stagedCatalog] = await Promise.all([
    readCatalog(pg, db, 'public'),
    readCatalog(pg, db, STAGING_SCHEMA),
  ]);
  const differences = diffCatalogs(live, stagedCatalog);
  if (differences.length > 0) {
    throw new RefusalError(
      `${differences.length} definition difference(s), staged vs live; re-run stage for the list`,
    );
  }
  const present = new Set(
    (
      await pg.psql(
        db,
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      )
    ).map(([t]) => t),
  );
  return USER_TABLES.filter((t) => present.has(t));
}

export function parseReport(rows: string[][]): SwapReport {
  const line = rows.map(([field]) => field).find((f) => f.startsWith('{'));
  if (!line) throw new Error('the swap produced no report');
  return JSON.parse(line) as SwapReport;
}

export async function runSwap(
  pg: PgRunner,
  options: {
    targetDb: string;
    manifestPath: string;
    mode: SwapMode;
    lockTimeout: string;
  },
): Promise<SwapResult> {
  ident(options.targetDb);
  if (!/^\d+(ms|s)$/.test(options.lockTimeout)) {
    throw new RefusalError(`lock timeout must look like 5s or 500ms`);
  }
  const { manifest } = readManifest(options.manifestPath);
  const userTables = await preflight(pg, options.targetDb, manifest);
  if (options.mode === 'check') return { mode: 'check', committed: false };

  const commit = options.mode === 'apply';
  const rows = await pg.psql(
    options.targetDb,
    swapSql({ manifest, userTables, lockTimeout: options.lockTimeout, commit }),
  );
  if (commit) {
    // PostgREST caches table OIDs; tell it the tables changed.
    await pg.psql(options.targetDb, `NOTIFY pgrst, 'reload schema'`);
  }
  return { mode: options.mode, committed: commit, report: parseReport(rows) };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function report(result: SwapResult): void {
  if (!result.report) {
    console.log(
      'pre-checks passed: staged, identical in definition, nothing in the way.',
    );
    console.log(
      'nothing locked or changed. --rehearse to try it, --apply to swap.',
    );
    return;
  }
  const r = result.report;
  for (const [ref, n] of Object.entries(r.remapped))
    console.log(`re-pointed ${ref}: ${n}`);
  for (const [ref, n] of Object.entries(r.softUnmatched)) {
    console.log(`unmatched soft reference ${ref}: ${n} (left as is)`);
  }
  for (const [t, n] of Object.entries(r.cachesEmptied ?? {}))
    console.log(`emptied ${t}: ${n} rows`);
  console.log(`foreign keys recreated: ${r.foreignKeysRecreated}`);
  console.log(
    `user tables unchanged: ${r.userTablesChecked}; civic tables as the manifest: ${r.civicTablesChecked}`,
  );
  console.log(
    result.committed
      ? 'COMMITTED. The corpus is live; PostgREST told to reload.'
      : 'rehearsal: every step succeeded and was ROLLED BACK. Nothing changed.',
  );
}

async function main(): Promise<void> {
  const targetDb = arg('target-db');
  const manifestPath = arg('manifest');
  if (!targetDb || !manifestPath || (flag('apply') && flag('rehearse'))) {
    console.error(
      'usage: swap.ts --target-db <db> --manifest <file> [--rehearse | --apply]',
    );
    process.exit(1);
  }
  const pg = flag('local')
    ? localPg()
    : containerPg(arg('container') ?? 'opuspopuli-db');
  const mode: SwapMode = flag('apply')
    ? 'apply'
    : flag('rehearse')
      ? 'rehearse'
      : 'check';
  try {
    report(
      await runSwap(pg, {
        targetDb,
        manifestPath,
        mode,
        lockTimeout: arg('lock-timeout') ?? '5s',
      }),
    );
  } catch (error) {
    const message = (error as Error).message;
    const refused =
      error instanceof RefusalError || message.includes('refused:');
    console.error(`${refused ? 'refused' : 'error'}: ${message}`);
    console.error('the transaction did not commit; production is as it was.');
    process.exit(refused ? 2 : 1);
  }
}

if (require.main === module) void main();

/**
 * Stage an exported corpus beside the live one (#1439, step 2 of 3).
 *
 * Runs against production while it serves. Everything here lands in
 * `corpus_staging`, a schema the application never reads; `public` is read
 * for comparison and never written. The slow part of the transfer — the
 * restore and its index builds — happens here, so the window's swap is
 * DDL and a few small updates.
 *
 * Usage (from apps/backend):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/corpus-transfer/stage.ts --target-db postgres \
 *     --manifest <dir>/corpus-<ts>.dump.manifest.json \
 *     [--apply --expect-sha256 <hex>] [--replace]
 *     [--container opuspopuli-db | --local]
 *
 * Without `--apply` it checks the dump and the target and restores nothing.
 * `--replace` drops a previous staging first. Exit codes: 0 staged and
 * identical, 2 refused, 1 error.
 *
 * Plan of record: docs/plans/1439-corpus-transfer.md §4.2.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  diffCatalogs,
  dependencyProblems,
  dropStagingSql,
  readCatalog,
  schemaExists,
} from './catalog';
import { inspectSource, tableCounts, verifyArchive } from './export';
import { argValue, hasFlag, runCommand, runnerFromArgs } from './cli';
import {
  STAGING_SCHEMA,
  parseManifest,
  sha256File,
  type CorpusManifest,
} from './manifest';
import { RefusalError, ident, type PgRunner } from './pg';
import { CIVIC_TABLES } from './tables';

export interface StageOptions {
  targetDb: string;
  manifestPath: string;
  apply: boolean;
  replace: boolean;
  /**
   * The dump's sha256 as `export` printed it, carried to the operator by a
   * route other than the files. Required to restore: the manifest's own
   * hash proves only that the two files agree, and whoever could replace
   * the dump could replace the manifest with it.
   */
  expectSha256?: string;
}

export interface StageResult {
  applied: boolean;
  dependencies: string[];
  differences: string[];
  countMismatches: string[];
  /** Regions enabled, added or reconfigured by the swap (plan O2). */
  regionPlugins: string[];
}

export function readManifest(path: string): {
  manifest: CorpusManifest;
  dumpPath: string;
} {
  let manifest: CorpusManifest;
  try {
    manifest = parseManifest(readFileSync(path, 'utf8'), CIVIC_TABLES);
  } catch (error) {
    throw new RefusalError((error as Error).message);
  }
  return { manifest, dumpPath: join(dirname(path), manifest.dump.file) };
}

/** The migration names on one side only, so a refusal says what differs. */
export function migrationDifferences(
  manifest: readonly string[],
  target: readonly string[],
): string[] {
  const inTarget = new Set(target);
  const inManifest = new Set(manifest);
  return [
    ...manifest
      .filter((m) => !inTarget.has(m))
      .map((m) => `only in dump: ${m}`),
    ...target
      .filter((m) => !inManifest.has(m))
      .map((m) => `only on target: ${m}`),
  ];
}

/** Every civic table whose staged count is not the manifest's, either way. */
export function countMismatches(
  expected: Record<string, number>,
  actual: Record<string, number>,
): string[] {
  const tables = new Set([
    ...CIVIC_TABLES,
    ...Object.keys(expected),
    ...Object.keys(actual),
  ]);
  return [...tables]
    .filter((table) => actual[table] !== expected[table])
    .map(
      (table) =>
        `${table}: manifest ${expected[table]}, staged ${actual[table]}`,
    )
    .sort((a, b) => a.localeCompare(b));
}

/**
 * How the swap would change region configuration (plan O2): regions on one
 * side only, and enabled flags, types, versions and parents that differ.
 * Config is compared but not printed; these are names and flags, never
 * user data.
 */
export function regionPluginsSql(): string {
  const l = 'public.region_plugins';
  const s = `${ident(STAGING_SCHEMA)}.region_plugins`;
  const changed = (col: string) =>
    `CASE WHEN l.${col} IS DISTINCT FROM s.${col} THEN '${col} ' || coalesce(l.${col}::text, '-') || ' -> ' || coalesce(s.${col}::text, '-') END`;
  return `SELECT concat_ws(': ', coalesce(l.name, s.name),
  CASE
    WHEN l.name IS NULL THEN 'only staged, enabled ' || s.enabled::text
    WHEN s.name IS NULL THEN 'only live, enabled ' || l.enabled::text
    ELSE concat_ws(', ', ${['enabled', 'plugin_type', 'version', 'parent_region_id'].map(changed).join(', ')},
      CASE WHEN l.config IS DISTINCT FROM s.config THEN 'config changed' END)
  END)
FROM ${l} l FULL JOIN ${s} s ON s.name = l.name
WHERE l.name IS NULL OR s.name IS NULL
   OR (l.enabled, l.plugin_type, l.version, l.parent_region_id, l.config)
      IS DISTINCT FROM (s.enabled, s.plugin_type, s.version, s.parent_region_id, s.config)
ORDER BY 1`;
}

/**
 * Statistics for the staged tables. A restore brings none, and `SET SCHEMA`
 * keeps whatever a table has — so without this, 33 GB could go live with no
 * statistics at all as the site reopens. Separate statements: VACUUM cannot
 * run inside a transaction.
 */
export function analyzeStagedSql(): string {
  return CIVIC_TABLES.map(
    (t) => `VACUUM (ANALYZE) ${ident(STAGING_SCHEMA)}.${ident(t)};`,
  ).join('\n');
}

async function checkDump(
  manifest: CorpusManifest,
  dumpPath: string,
  expected: string | undefined,
) {
  const actual = await sha256File(dumpPath);
  if (actual !== manifest.dump.sha256) {
    throw new RefusalError(
      `dump checksum ${actual} does not match the manifest's ${manifest.dump.sha256}`,
    );
  }
  if (expected !== undefined && actual !== expected.toLowerCase()) {
    throw new RefusalError(
      `dump checksum ${actual} is not the one given with --expect-sha256`,
    );
  }
}

async function checkTarget(
  pg: PgRunner,
  options: StageOptions,
  manifest: CorpusManifest,
): Promise<string[]> {
  const target = await inspectSource(pg, options.targetDb);
  const migrations = migrationDifferences(
    manifest.migrations,
    target.migrations,
  );
  if (migrations.length > 0) {
    throw new RefusalError(
      `migrations differ between dump and target: ${migrations.join('; ')}`,
    );
  }
  const staged = await schemaExists(pg, options.targetDb, STAGING_SCHEMA);
  if (staged && !options.replace) {
    throw new RefusalError(
      `${STAGING_SCHEMA} already exists on ${options.targetDb}; ` +
        'pass --replace to drop it and stage again',
    );
  }
  return dependencyProblems(pg, options.targetDb);
}

export async function runStage(
  pg: PgRunner,
  options: StageOptions,
): Promise<StageResult> {
  ident(options.targetDb);
  if (options.apply && !options.expectSha256) {
    throw new RefusalError(
      'restoring needs --expect-sha256 <hex>, the checksum export printed, ' +
        'carried separately from the files',
    );
  }
  const { manifest, dumpPath } = readManifest(options.manifestPath);
  await checkDump(manifest, dumpPath, options.expectSha256);
  // The listing is checked again here, not just at export, and before a
  // previous staging is dropped. It cannot prove what each entry's SQL does
  // — the checksum above, given out of band, is what makes the file the one
  // that was exported — but it does mean no `-n` filter is needed, which
  // matters: `pg_restore -n` skips the schema's own CREATE SCHEMA entry.
  verifyArchive(await pg.listArchive(dumpPath));
  const dependencies = await checkTarget(pg, options, manifest);
  const result: StageResult = {
    applied: false,
    dependencies,
    differences: [],
    countMismatches: [],
    regionPlugins: [],
  };
  if (!options.apply) return result;
  if (dependencies.length > 0) {
    throw new RefusalError(
      `the target has objects a swap would break: ${dependencies.join('; ')}`,
    );
  }

  if (await schemaExists(pg, options.targetDb, STAGING_SCHEMA)) {
    await pg.psql(options.targetDb, dropStagingSql());
  }
  // One transaction: a restore that fails leaves no half-built schema.
  await pg.restoreFromFile(
    options.targetDb,
    ['--single-transaction', '--exit-on-error'],
    dumpPath,
  );

  await pg.psql(options.targetDb, analyzeStagedSql());

  const [live, staged] = await Promise.all([
    readCatalog(pg, options.targetDb, 'public'),
    readCatalog(pg, options.targetDb, STAGING_SCHEMA),
  ]);
  return {
    ...result,
    applied: true,
    differences: diffCatalogs(live, staged),
    countMismatches: countMismatches(
      manifest.tables,
      await tableCounts(pg, options.targetDb, STAGING_SCHEMA),
    ),
    regionPlugins: (await pg.psql(options.targetDb, regionPluginsSql())).map(
      ([line]) => line,
    ),
  };
}

/** Staged, and identical to what will be swapped out. */
export function isReady(result: StageResult): boolean {
  return (
    result.applied &&
    result.dependencies.length === 0 &&
    result.differences.length === 0 &&
    result.countMismatches.length === 0
  );
}

function printList(title: string, lines: string[]): void {
  console.log(`${title}: ${lines.length === 0 ? 'none' : lines.length}`);
  for (const line of lines.slice(0, 50)) console.log(`  ${line}`);
  if (lines.length > 50) console.log(`  … and ${lines.length - 50} more`);
}

function report(result: StageResult): void {
  printList('objects a swap would break', result.dependencies);
  if (!result.applied) {
    console.log('dry run: dump and target checked, nothing restored.');
    return;
  }
  printList('definition differences, staged vs live', result.differences);
  printList('row counts differing from the manifest', result.countMismatches);
  printList(
    'region configuration the swap would change (owner decides, plan O2)',
    result.regionPlugins,
  );
  console.log(
    isReady(result)
      ? `staged: ${STAGING_SCHEMA} is identical in definition to public and ready to swap`
      : `staged but NOT ready: ${STAGING_SCHEMA} is left in place for inspection; the swap will refuse it`,
  );
}

async function main(): Promise<void> {
  await runCommand(async () => {
    const targetDb = argValue('target-db');
    const manifestPath = argValue('manifest');
    if (!targetDb || !manifestPath) {
      throw new RefusalError(
        'usage: stage.ts --target-db <db> --manifest <file> ' +
          '[--apply --expect-sha256 <hex>] [--replace]',
      );
    }
    const result = await runStage(runnerFromArgs(), {
      targetDb,
      manifestPath,
      apply: hasFlag('apply'),
      replace: hasFlag('replace'),
      expectSha256: argValue('expect-sha256'),
    });
    report(result);
    if (result.applied && !isReady(result)) process.exit(2);
  });
}

if (require.main === module) void main();

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
 *     [--apply] [--replace] [--container opuspopuli-db | --local]
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
import {
  MANIFEST_FORMAT,
  STAGING_SCHEMA,
  sha256File,
  type CorpusManifest,
} from './manifest';
import { RefusalError, containerPg, ident, localPg, type PgRunner } from './pg';

export interface StageOptions {
  targetDb: string;
  manifestPath: string;
  apply: boolean;
  replace: boolean;
}

export interface StageResult {
  applied: boolean;
  dependencies: string[];
  differences: string[];
  countMismatches: string[];
}

export function readManifest(path: string): {
  manifest: CorpusManifest;
  dumpPath: string;
} {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as CorpusManifest;
  if (manifest.format !== MANIFEST_FORMAT) {
    throw new RefusalError(`not a corpus manifest: format ${manifest.format}`);
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

export function countMismatches(
  expected: Record<string, number>,
  actual: Record<string, number>,
): string[] {
  return Object.entries(expected)
    .filter(([table, rows]) => actual[table] !== rows)
    .map(
      ([table, rows]) => `${table}: manifest ${rows}, staged ${actual[table]}`,
    );
}

async function checkDump(manifest: CorpusManifest, dumpPath: string) {
  const actual = await sha256File(dumpPath);
  if (actual !== manifest.dump.sha256) {
    throw new RefusalError(
      `dump checksum ${actual} does not match the manifest's ${manifest.dump.sha256}`,
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
  const { manifest, dumpPath } = readManifest(options.manifestPath);
  await checkDump(manifest, dumpPath);
  const dependencies = await checkTarget(pg, options, manifest);
  const result: StageResult = {
    applied: false,
    dependencies,
    differences: [],
    countMismatches: [],
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
  // The archive is checked again here, not just at export: the checksum
  // proves the file is the one the manifest describes, this proves what it
  // restores. Then no `-n` filter is needed — which matters, because
  // `pg_restore -n` skips the schema's own CREATE SCHEMA entry.
  verifyArchive(await pg.listArchive(dumpPath));
  // One transaction: a restore that fails leaves no half-built schema.
  await pg.restoreFromFile(
    options.targetDb,
    ['--single-transaction', '--exit-on-error'],
    dumpPath,
  );

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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const flag = (name: string) => process.argv.includes(`--${name}`);

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
  console.log(
    isReady(result)
      ? `staged: ${STAGING_SCHEMA} is identical in definition to public and ready to swap`
      : `staged but NOT ready: ${STAGING_SCHEMA} is left in place for inspection; the swap will refuse it`,
  );
}

async function main(): Promise<void> {
  const targetDb = arg('target-db');
  const manifestPath = arg('manifest');
  if (!targetDb || !manifestPath) {
    console.error(
      'usage: stage.ts --target-db <db> --manifest <file> [--apply]',
    );
    process.exit(1);
  }
  const pg = flag('local')
    ? localPg()
    : containerPg(arg('container') ?? 'opuspopuli-db');
  try {
    const result = await runStage(pg, {
      targetDb,
      manifestPath,
      apply: flag('apply'),
      replace: flag('replace'),
    });
    report(result);
    if (result.applied && !isReady(result)) process.exit(2);
  } catch (error) {
    const refused = error instanceof RefusalError;
    console.error(
      `${refused ? 'refused' : 'error'}: ${(error as Error).message}`,
    );
    process.exit(refused ? 2 : 1);
  }
}

if (require.main === module) void main();

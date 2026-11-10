/**
 * Export UAT's civic corpus as one dump and a manifest (#1439, step 1 of 3).
 *
 * The source database is never written. The export clones it at file level
 * (`CREATE DATABASE … TEMPLATE`), applies the export rules to the clone,
 * moves only the civic tables into `corpus_staging`, and dumps that schema
 * alone. The clone is dropped whatever happens.
 *
 * Why a clone, not a table-by-table copy: civic tables use 26 enum types,
 * extension types (`vector`, `geometry`) and operator classes that live
 * outside their own definitions. A clone carries all of it exactly; a copy
 * would have to rebuild each. What keeps personal data in is not how the
 * clone is built but what leaves it: the dump's own table of contents is
 * checked, and the export refuses unless it holds the civic tables and
 * nothing else.
 *
 * The clone needs the source to have no other sessions — run it during the
 * D3a freeze, with the stack's services stopped and the database up.
 *
 * Usage (from apps/backend):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/corpus-transfer/export.ts --source-db postgres --out-dir <dir> \
 *     [--include-finance] [--apply] [--container opuspopuli-db | --local]
 *
 * Without `--apply` it checks the source and reports what it would ship,
 * writing nothing. Exit codes: 0 done, 2 refused, 1 error.
 *
 * Plan of record: docs/plans/1439-corpus-transfer.md §4.1.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  MANIFEST_FORMAT,
  STAGING_SCHEMA,
  sha256File,
  type BillSummaryRule,
  type CorpusManifest,
} from './manifest';
import {
  RefusalError,
  containerPg,
  ident,
  literal,
  localPg,
  type PgRunner,
} from './pg';
import { CIVIC_TABLES, FINANCE_TABLES, unclassifiedTables } from './tables';

/** Where CREATE/DROP DATABASE run: never the source, which must be idle. */
export const ADMIN_DATABASE = 'template1';

export interface ExportOptions {
  sourceDb: string;
  outDir: string;
  includeFinance: boolean;
  apply: boolean;
  gitSha: string | null;
  now: Date;
}

export interface ExportResult {
  applied: boolean;
  migrations: number;
  billSummaries: BillSummaryRule;
  otherSessions: number;
  manifestPath?: string;
  manifest?: CorpusManifest;
}

interface SourceState {
  migrations: string[];
}

/** Refuse a source the export cannot faithfully represent. */
export async function inspectSource(
  pg: PgRunner,
  db: string,
): Promise<SourceState> {
  const [[unresolved]] = await pg.psql(
    db,
    `SELECT count(*) FROM _prisma_migrations
     WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
  );
  if (Number(unresolved) > 0) {
    throw new RefusalError(
      `${unresolved} migration(s) started but not finished on ${db}`,
    );
  }
  const migrations = (
    await pg.psql(
      db,
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY 1`,
    )
  ).map(([name]) => name);

  const tables = (
    await pg.psql(
      db,
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    )
  ).map(([name]) => name);
  const unknown = unclassifiedTables(tables);
  if (unknown.length > 0) {
    throw new RefusalError(
      `tables in ${db}.public that no class names (add them to tables.ts): ` +
        unknown.join(', '),
    );
  }
  const present = new Set(tables);
  const missing = CIVIC_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new RefusalError(
      `civic tables missing from ${db}: ${missing.join(', ')}`,
    );
  }
  return { migrations };
}

/** Client sessions on `db` other than this tool's. */
export async function otherSessions(pg: PgRunner, db: string): Promise<number> {
  const [[count]] = await pg.psql(
    ADMIN_DATABASE,
    `SELECT count(*) FROM pg_stat_activity
     WHERE datname = ${literal(db)} AND backend_type = 'client backend'
       AND pid <> pg_backend_pid()`,
  );
  return Number(count);
}

/**
 * The bills whose stored summary does not ship (#1429 D3).
 *
 * Mirrors `summaryStateOf` minus the parts only prod can judge: a summary
 * ships when it records its prompt hash and model digest and, for an
 * official bill, was written from the version the app treats as current —
 * the lowest version number, ties by ID, counted only when it has text
 * (`bill-summary.service.ts` `live`). Whether prod serves the same template
 * and model is prod's call; there a mismatch shows the summary as stale,
 * with an Update button, rather than hiding it.
 */
export function summariesToClear(schema: string): string {
  const s = ident(schema);
  return `
    SELECT b.id FROM ${s}.bills b
    LEFT JOIN LATERAL (
      SELECT v.external_id, v.bill_xml IS NOT NULL AS has_text
      FROM ${s}.pubinfo_bill_versions v
      WHERE v.bill_id = b.external_id
      ORDER BY v.version_num ASC, v.external_id ASC
      LIMIT 1
    ) cur ON true
    WHERE b.ai_summary IS NOT NULL
      AND NOT (
        jsonb_typeof(b.ai_summary) = 'object'
        AND b.ai_summary_prompt_hash IS NOT NULL
        AND b.ai_summary_llm_digest IS NOT NULL
        AND NOT (
          b.status_source = 'official'
          AND COALESCE(cur.has_text, false)
          AND b.ai_summary_source_version IS DISTINCT FROM cur.external_id
        )
      )`;
}

export async function billSummaryCounts(
  pg: PgRunner,
  db: string,
  schema: string,
): Promise<BillSummaryRule> {
  const [[present, cleared]] = await pg.psql(
    db,
    `SELECT
       (SELECT count(*) FROM ${ident(schema)}.bills WHERE ai_summary IS NOT NULL),
       (SELECT count(*) FROM (${summariesToClear(schema)}) c)`,
  );
  return {
    present: Number(present),
    kept: Number(present) - Number(cleared),
    cleared: Number(cleared),
  };
}

const SUMMARY_COLUMNS = [
  'ai_summary',
  'ai_summary_version',
  'ai_summary_generated_at',
  'ai_summary_prompt_hash',
  'ai_summary_prompt_version',
  'ai_summary_llm_model',
  'ai_summary_llm_digest',
  'ai_summary_source_version',
  'ai_summary_failed_at',
];

/** The clone's whole transformation, in one transaction. */
export function prepareCloneSql(includeFinance: boolean): string {
  const clear = SUMMARY_COLUMNS.map((c) => `${ident(c)} = NULL`).join(', ');
  const finance = includeFinance
    ? ''
    : // Nothing outside finance references it (tables.spec.ts), so this
      // cascades nowhere; the tables still ship, empty (O4).
      `TRUNCATE ${FINANCE_TABLES.map((t) => `public.${ident(t)}`).join(', ')};`;
  const moves = CIVIC_TABLES.map(
    (t) =>
      `ALTER TABLE public.${ident(t)} SET SCHEMA ${ident(STAGING_SCHEMA)};`,
  ).join('\n');
  return `BEGIN;
UPDATE public.bills SET ${clear}
  WHERE id IN (${summariesToClear('public')});
${finance}
CREATE SCHEMA ${ident(STAGING_SCHEMA)};
${moves}
COMMIT;`;
}

export async function tableCounts(
  pg: PgRunner,
  db: string,
  schema: string,
): Promise<Record<string, number>> {
  const sql = CIVIC_TABLES.map(
    (t) => `SELECT ${literal(t)}, count(*) FROM ${ident(schema)}.${ident(t)}`,
  ).join('\nUNION ALL\n');
  const rows = await pg.psql(db, sql);
  return Object.fromEntries(rows.map(([t, n]) => [t, Number(n)]));
}

/**
 * Refuse a dump that holds anything but the civic tables.
 *
 * This is the export's last word on personal data, and it reads the
 * artifact rather than trusting how it was made: every entry must belong to
 * the staging schema, and the tables and table data present must be
 * exactly the civic set.
 */
export function verifyArchive(toc: string): void {
  const entries = toc
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith(';'));
  const outside = entries.filter(
    (line) => !line.split(/\s+/).includes(STAGING_SCHEMA),
  );
  if (outside.length > 0) {
    throw new RefusalError(
      `dump holds ${outside.length} entr(ies) outside ${STAGING_SCHEMA}`,
    );
  }
  const named = (type: string) =>
    entries
      .map((line) =>
        new RegExp(`^\\d+; \\d+ \\d+ ${type} ${STAGING_SCHEMA} (\\S+) `).exec(
          line,
        ),
      )
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1])
      .sort();
  const civic: string[] = [...CIVIC_TABLES].sort();
  for (const type of ['TABLE', 'TABLE DATA']) {
    const found = named(type);
    if (found.join() !== civic.join()) {
      const extra = found.filter((t) => !civic.includes(t));
      const missing = civic.filter((t) => !found.includes(t));
      throw new RefusalError(
        `dump's ${type} entries differ from the civic tables` +
          (extra.length ? `; extra: ${extra.join(', ')}` : '') +
          (missing.length ? `; missing: ${missing.join(', ')}` : ''),
      );
    }
  }
}

export function stamp(now: Date): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

async function dropDatabase(pg: PgRunner, db: string): Promise<void> {
  await pg.psql(
    ADMIN_DATABASE,
    `DROP DATABASE IF EXISTS ${ident(db)} WITH (FORCE)`,
  );
}

async function dumpClone(
  pg: PgRunner,
  clone: string,
  options: ExportOptions,
  source: SourceState,
  billSummaries: BillSummaryRule,
): Promise<{ manifest: CorpusManifest; manifestPath: string }> {
  await pg.psql(clone, prepareCloneSql(options.includeFinance));
  const tables = await tableCounts(pg, clone, STAGING_SCHEMA);

  mkdirSync(options.outDir, { recursive: true });
  const file = join(options.outDir, `corpus-${stamp(options.now)}.dump`);
  try {
    await pg.dumpToFile(clone, ['-Fc', '-n', STAGING_SCHEMA], file);
    verifyArchive(await pg.listArchive(file));
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }

  const manifest: CorpusManifest = {
    format: MANIFEST_FORMAT,
    createdAt: options.now.toISOString(),
    gitSha: options.gitSha,
    sourceDatabase: options.sourceDb,
    migrations: source.migrations,
    includeFinance: options.includeFinance,
    tables,
    rules: { billSummaries },
    dump: {
      file: basename(file),
      bytes: statSync(file).size,
      sha256: await sha256File(file),
    },
  };
  const manifestPath = `${file}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath };
}

export async function runExport(
  pg: PgRunner,
  options: ExportOptions,
): Promise<ExportResult> {
  ident(options.sourceDb);
  const source = await inspectSource(pg, options.sourceDb);
  const billSummaries = await billSummaryCounts(pg, options.sourceDb, 'public');
  const sessions = await otherSessions(pg, options.sourceDb);
  const result: ExportResult = {
    applied: false,
    migrations: source.migrations.length,
    billSummaries,
    otherSessions: sessions,
  };
  if (!options.apply) return result;

  if (sessions > 0) {
    throw new RefusalError(
      `${sessions} other session(s) on ${options.sourceDb}; stop the stack's ` +
        'services (keep the database running) and retry',
    );
  }
  const clone = `corpus_export_${stamp(options.now)}`;
  await pg.psql(
    ADMIN_DATABASE,
    `CREATE DATABASE ${ident(clone)} TEMPLATE ${ident(options.sourceDb)}`,
  );
  try {
    return {
      ...result,
      applied: true,
      ...(await dumpClone(pg, clone, options, source, billSummaries)),
    };
  } finally {
    await dropDatabase(pg, clone);
  }
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function gitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function report(result: ExportResult): void {
  const s = result.billSummaries;
  console.log(`migrations applied on source: ${result.migrations}`);
  console.log(
    `bill summaries: ${s.present} stored, ${s.kept} ship, ${s.cleared} cleared (#1429 D3)`,
  );
  if (!result.applied) {
    console.log(`other sessions on source: ${result.otherSessions}`);
    console.log('dry run: nothing written. Re-run with --apply to export.');
    return;
  }
  const m = result.manifest!;
  for (const [table, rows] of Object.entries(m.tables)) {
    console.log(`  ${table.padEnd(40)} ${rows}`);
  }
  console.log(
    `finance: ${m.includeFinance ? 'included' : 'shipped empty (O4)'}`,
  );
  console.log(
    `dump: ${m.dump.file}, ${m.dump.bytes} bytes, sha256 ${m.dump.sha256}`,
  );
  console.log(`manifest: ${result.manifestPath}`);
}

async function main(): Promise<void> {
  const sourceDb = arg('source-db');
  const outDir = arg('out-dir');
  if (!sourceDb || !outDir) {
    console.error(
      'usage: export.ts --source-db <db> --out-dir <dir> [--apply]',
    );
    process.exit(1);
  }
  const pg = flag('local')
    ? localPg()
    : containerPg(arg('container') ?? 'opuspopuli-db');
  try {
    report(
      await runExport(pg, {
        sourceDb,
        outDir,
        includeFinance: flag('include-finance'),
        apply: flag('apply'),
        gitSha: gitSha(),
        now: new Date(),
      }),
    );
  } catch (error) {
    const refused = error instanceof RefusalError;
    console.error(
      `${refused ? 'refused' : 'error'}: ${(error as Error).message}`,
    );
    process.exit(refused ? 2 : 1);
  }
}

if (require.main === module) void main();

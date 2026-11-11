/**
 * What `export` promises and `stage` checks (#1439).
 *
 * Counts and identifiers only. Nothing here is row content, so the manifest
 * can be read, diffed and pasted into a runbook without review.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const MANIFEST_FORMAT = 'opuspopuli-corpus/1';

/** The schema the export moves civic tables into, and stage restores. */
export const STAGING_SCHEMA = 'corpus_staging';

export interface BillSummaryRule {
  /** Bills with any stored summary. */
  present: number;
  /** Shipped: prompt hash, model digest, and the current bill version. */
  kept: number;
  /** Cleared at export (#1429 D3); prod writes them on first view. */
  cleared: number;
}

export interface CorpusManifest {
  format: typeof MANIFEST_FORMAT;
  createdAt: string;
  gitSha: string | null;
  sourceDatabase: string;
  /** Applied migrations, sorted. `stage` refuses a target whose list differs. */
  migrations: string[];
  includeFinance: boolean;
  /** Row count per civic table, as dumped. */
  tables: Record<string, number>;
  rules: { billSummaries: BillSummaryRule };
  dump: { file: string; bytes: number; sha256: string };
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const SHA256 = /^[0-9a-f]{64}$/;
/** What `export` names its dumps. Nothing else is opened: no paths. */
const DUMP_FILE = /^corpus-\d{14}\.dump$/;

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Validate a manifest read from disk. It travels with the dump and is as
 * easy to edit, so nothing in it is used until its shape is right: the dump
 * name must be a bare export name (no `../`), the tables exactly the ones
 * expected, the counts non-negative integers.
 */
export function parseManifest(
  json: string,
  expectedTables: readonly string[],
): CorpusManifest {
  const m = JSON.parse(json) as Partial<CorpusManifest>;
  const problems: string[] = [];
  if (m.format !== MANIFEST_FORMAT) problems.push(`format ${String(m.format)}`);
  if (!m.dump || !DUMP_FILE.test(String(m.dump.file)))
    problems.push('dump.file');
  if (!m.dump || !SHA256.test(String(m.dump.sha256)))
    problems.push('dump.sha256');
  if (
    !Array.isArray(m.migrations) ||
    !m.migrations.every((x) => typeof x === 'string')
  ) {
    problems.push('migrations');
  }
  const tables = Object.entries(m.tables ?? {});
  const names = tables.map(([t]) => t).sort((a, b) => a.localeCompare(b));
  const expected = [...expectedTables].sort((a, b) => a.localeCompare(b));
  if (
    names.join() !== expected.join() ||
    !tables.every(([, n]) => isCount(n))
  ) {
    problems.push('tables');
  }
  if (problems.length > 0) {
    throw new Error(`not a valid corpus manifest: ${problems.join(', ')}`);
  }
  return m as CorpusManifest;
}

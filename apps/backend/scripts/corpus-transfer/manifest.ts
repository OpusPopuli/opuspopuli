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

/**
 * Which tables the corpus transfer moves, keeps, empties or ignores (#1439).
 *
 * This list is the safety boundary of the whole tool. The export copies by
 * allowlist — only {@link CIVIC_TABLES} ever leave UAT — so personal data
 * cannot ride along in a table nobody thought about. The other direction is
 * guarded too: every table must be in exactly one class, and
 * `tables.spec.ts` fails if a Prisma model is added without being placed
 * here. At run time the commands refuse a database whose `public` schema
 * holds a table this file does not know, which covers the tables Prisma
 * never sees (see {@link USER_TABLES} and {@link INFRA_TABLES}).
 *
 * Plan of record: `docs/plans/1439-corpus-transfer.md` §2–§3.
 */

/**
 * Campaign finance: 31 of UAT's 33 GB. A subset of the civic class, not a
 * class of its own — it moves with everything else or not at all, because
 * it references propositions, representatives and pipeline executions by
 * ID (see `tables.spec.ts`, "finance is not separable").
 */
export const FINANCE_TABLES = [
  'committees',
  'committee_measure_positions',
  'contributions',
  'expenditures',
  'independent_expenditures',
  'filing_summaries',
  'filing_reconciliations',
  'cvr_filings',
  'cvr2_filings',
] as const;

/** Public civic records: replaced wholesale from UAT. */
export const CIVIC_TABLES = [
  // bills
  'bills',
  'bill_co_authors',
  'bill_committee_assignments',
  'bill_votes',
  'pubinfo_bills',
  'pubinfo_bill_versions',
  'pubinfo_bill_version_authors',
  'pubinfo_bill_history',
  'pubinfo_committee_hearings',
  'pubinfo_bill_summary_votes',
  'pubinfo_bill_detail_votes',
  'pubinfo_bill_motions',
  'pubinfo_legislators',
  'pubinfo_location_codes',
  // propositions and representatives
  'propositions',
  'representatives',
  'representative_committee_assignments',
  'legislative_committees',
  'legislative_actions',
  // meetings
  'meetings',
  'minutes',
  // civics
  'civics_blocks',
  'civics_page_extractions',
  'glossary_entries',
  'glossary_entry_sources',
  // provenance and pipeline
  'claims',
  'evidence',
  'claim_evidence',
  'claim_relations',
  'source_versions',
  'bulk_snapshots',
  'bulk_imports',
  'pipeline_executions',
  'pipeline_execution_batches',
  'pipeline_jobs',
  'structural_manifests',
  'structural_analysis_jobs',
  'ingestion_watermarks',
  // geography and config
  'jurisdictions',
  'county_thresholds',
  'county_adjacency',
  'region_plugins',
  ...FINANCE_TABLES,
] as const;

/**
 * Personal data (CCPA personal information): kept from production, never
 * exported, never read into a report.
 */
export const USER_TABLES = [
  'users',
  'user_profiles',
  'signal_profiles',
  'sensitive_profiles',
  'user_events',
  'user_logins',
  'user_sessions',
  'passkey_credentials',
  'webauthn_challenges',
  'user_consents',
  'user_addresses',
  'user_jurisdictions',
  'email_correspondence',
  'notification_preferences',
  'documents',
  'document_propositions',
  'abuse_reports',
  'audit_logs',
  /**
   * The knowledge service's RAG chunks of users' documents, keyed by
   * `user_id` and `document_id`. Not a Prisma model: `pgvector.provider.ts`
   * creates it at boot as `<collection>_vectors`. Civic embeddings are not
   * here — they are columns on the civic tables themselves.
   */
  'default_embeddings_vectors',
  /**
   * Bookkeeping from the #1071 signal backfill migration (user ID and the
   * field it wrote), so its rollback undoes only its own writes. Not a
   * Prisma model, and present only where that migration's run left it:
   * found by the runtime check on a freshly migrated database (2026-11-09).
   */
  '_backfill_1071_signal_writes',
] as const;

/**
 * Per-user derived data. Emptied by the swap (their foreign keys cascade
 * from civic rows that are about to be replaced) and rebuilt on demand.
 */
export const CACHE_TABLES = [
  'bill_relevance_cache',
  'proposition_relevance_cache',
  'representative_relevance_cache',
  'committee_relevance_cache',
  'briefing_summary_cache',
  'personalized_impact_cache',
  'llm_rerank_jobs',
] as const;

/** Re-seeded by the deploy itself; the transfer leaves it alone. */
export const SEED_TABLES = ['prompt_templates'] as const;

/**
 * Owned by tooling, not by the application: each database keeps its own.
 * Neither is a Prisma model.
 */
export const INFRA_TABLES = [
  '_prisma_migrations',
  // PostGIS's own table, present where the extension lives in `public`.
  'spatial_ref_sys',
] as const;

export type TableClass = 'civic' | 'user' | 'cache' | 'seed' | 'infra';

const CLASSES: ReadonlyArray<readonly [TableClass, readonly string[]]> = [
  ['civic', CIVIC_TABLES],
  ['user', USER_TABLES],
  ['cache', CACHE_TABLES],
  ['seed', SEED_TABLES],
  ['infra', INFRA_TABLES],
];

const CLASS_OF: ReadonlyMap<string, TableClass> = new Map(
  CLASSES.flatMap(([cls, tables]) => tables.map((t) => [t, cls] as const)),
);

/** The class of a table, or `undefined` when this file does not know it. */
export function classOf(table: string): TableClass | undefined {
  return CLASS_OF.get(table);
}

/**
 * The tables in `tables` that belong to no class. A command handed a
 * database with any of these refuses to run: an unknown table might hold
 * personal data, or civic data the swap would silently leave behind.
 */
export function unclassifiedTables(tables: Iterable<string>): string[] {
  return [...tables]
    .filter((t) => !CLASS_OF.has(t))
    .sort((a, b) => a.localeCompare(b));
}

export function isFinanceTable(table: string): boolean {
  return (FINANCE_TABLES as readonly string[]).includes(table);
}

/**
 * The only foreign keys from kept data into the corpus. The swap re-points
 * each by a natural key, because the staged rows carry UAT's IDs, and
 * refuses to commit if any reference finds no match (§3). Any other foreign
 * key from a user or seed table into a civic one is a schema change this
 * tool has not been taught about, and `tables.spec.ts` fails on it.
 *
 * `naturalKeys` are tried in order; each is unique on the target.
 */
export interface RemappedReference {
  table: string;
  column: string;
  target: string;
  naturalKeys: readonly (readonly string[])[];
}

export const REMAPPED_REFERENCES: readonly RemappedReference[] = [
  {
    table: 'document_propositions',
    column: 'proposition_id',
    target: 'propositions',
    naturalKeys: [['region_plugin_name', 'external_id']],
  },
  {
    table: 'user_jurisdictions',
    column: 'jurisdiction_id',
    target: 'jurisdictions',
    naturalKeys: [['ocd_id'], ['fips_code']],
  },
];

/**
 * Columns in kept data that hold a corpus ID with no foreign key behind
 * them. The swap re-points each where the natural key matches and reports
 * the rest by count: an unmatched one names a record UAT doesn't have, and
 * there is nothing better to point it at. Never content, never the user.
 *
 * Audited 2026-11-09 against every non-FK, ID-shaped or JSON column on a
 * user table: `user_events.object_id` and `audit_logs.entity_id` record
 * IDs that were valid when written and are left alone; the JSON columns
 * hold tags and extracted text, not IDs.
 */
export const SOFT_REFERENCES: readonly RemappedReference[] = [
  {
    table: 'email_correspondence',
    column: 'representative_id',
    target: 'representatives',
    naturalKeys: [['external_id']],
  },
  {
    table: 'email_correspondence',
    column: 'proposition_id',
    target: 'propositions',
    naturalKeys: [['region_plugin_name', 'external_id']],
  },
];

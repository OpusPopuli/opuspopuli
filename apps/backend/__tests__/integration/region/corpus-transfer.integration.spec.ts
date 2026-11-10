/**
 * The corpus transfer end to end, on real databases (#1439, S5).
 *
 * Two databases of its own, migrated like postgres_test: a "UAT" source and
 * a "production" target whose civic rows share natural keys with the source
 * but not IDs — the situation the swap's remaps exist for. Every command
 * runs for real: export (clone, D3 rule, dump, archive check), stage
 * (restore, catalog diff), swap (rehearsal, refusals, commit).
 *
 * Fixtures are synthetic: example.test addresses, made-up IDs.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExport } from '../../../scripts/corpus-transfer/export';
import { dropStagingSql } from '../../../scripts/corpus-transfer/catalog';
import type { CorpusManifest } from '../../../scripts/corpus-transfer/manifest';
import { containerPg } from '../../../scripts/corpus-transfer/pg';
import { isReady, runStage } from '../../../scripts/corpus-transfer/stage';
import { runSwap } from '../../../scripts/corpus-transfer/swap';

const SRC = 'corpus_src_test';
const DST = 'corpus_dst_test';
const pg = containerPg(
  process.env.CORPUS_TRANSFER_PG_CONTAINER ?? 'opuspopuli-db',
);
const one = async (db: string, sql: string) => (await pg.psql(db, sql))[0]?.[0];

const EXTENSIONS = ['pgcrypto', 'pg_trgm', 'postgis', 'uuid-ossp', 'vector'];

async function createMigrated(db: string): Promise<void> {
  // From `postgres`: a plain CREATE DATABASE copies template1, which must
  // then have no sessions — including this one.
  await pg.psql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await pg.psql('postgres', `CREATE DATABASE ${db}`);
  for (const ext of EXTENSIONS) {
    await pg.psql(db, `CREATE EXTENSION IF NOT EXISTS "${ext}"`);
  }
  const url = process.env.DATABASE_URL!.replace(
    /\/[A-Za-z0-9_]+(?=[?#]|$)/,
    `/${db}`,
  );
  execSync(
    'pnpm --filter @opuspopuli/relationaldb-provider exec prisma migrate deploy',
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Through unknown: the app augments ProcessEnv with a numeric PORT.
      env: {
        ...process.env,
        DATABASE_URL: url,
      } as unknown as NodeJS.ProcessEnv,
    },
  );
}

const SOURCE_SEED = `
INSERT INTO propositions (id, external_id, title, summary, region_plugin_name) VALUES
  ('src-p1', 'P-1', 'Measure one', 's', 'california'),
  ('src-p2', 'P-2', 'Measure two', 's', 'california');
INSERT INTO jurisdictions (id, name, type, level, state_code, ocd_id, fips_code) VALUES
  ('src-j1', 'Test State', 'STATE', 'STATE', 'ZZ', 'ocd-division/country:us/state:zz', NULL),
  ('src-j2', 'Test County', 'COUNTY', 'COUNTY', 'ZZ', NULL, '99001');
INSERT INTO representatives (id, external_id, name, chamber, district) VALUES
  ('src-r1', 'R-1', 'Rep One', 'Assembly', '1');
INSERT INTO bills (id, external_id, region_id, bill_number, session_year, measure_type_code,
                   title, source_url, status_source, ai_summary, ai_summary_prompt_hash,
                   ai_summary_llm_digest, ai_summary_source_version) VALUES
  ('src-b1', 'B-1', 'california', 'AB 1', '2025', 'AB', 'Bill one', 'https://example.test/1',
   'official', '{"plainEnglishSummary": "kept"}', 'hash', 'digest', 'V-1'),
  ('src-b2', 'B-2', 'california', 'AB 2', '2025', 'AB', 'Bill two', 'https://example.test/2',
   'official', '{"plainEnglishSummary": "no provenance"}', NULL, NULL, NULL);
INSERT INTO pubinfo_bill_versions (id, external_id, bill_id, version_num, bill_version_action_date,
                                   updated_at, bill_xml) VALUES
  ('src-v1', 'V-1', 'B-1', 1, '2025-01-01', now(), '<bill/>');
-- A UAT user that must never travel.
INSERT INTO users (id, email) VALUES ('src-user', 'uat-only@example.test');
`;

const TARGET_SEED = `
INSERT INTO propositions (id, external_id, title, summary, region_plugin_name) VALUES
  ('dst-p1', 'P-1', 'Measure one', 's', 'california'),
  ('dst-p2', 'P-2', 'Measure two', 's', 'california'),
  ('dst-p3', 'P-3', 'Not in UAT', 's', 'california');
INSERT INTO jurisdictions (id, name, type, level, state_code, ocd_id, fips_code) VALUES
  ('dst-j1', 'Test State', 'STATE', 'STATE', 'ZZ', 'ocd-division/country:us/state:zz', NULL),
  ('dst-j2', 'Test County', 'COUNTY', 'COUNTY', 'ZZ', NULL, '99001');
INSERT INTO representatives (id, external_id, name, chamber, district) VALUES
  ('dst-r1', 'R-1', 'Rep One', 'Assembly', '1'),
  ('dst-r9', 'R-9', 'Not in UAT', 'Senate', '9');
INSERT INTO users (id, email) VALUES ('dst-user', 'prod-user@example.test');
INSERT INTO user_addresses (id, user_id, address_line_1, city, state, postal_code) VALUES
  ('dst-a1', 'dst-user', '1 Test St', 'Testville', 'ZZ', '00000');
INSERT INTO user_jurisdictions (id, user_id, user_address_id, jurisdiction_id, resolved_by) VALUES
  ('dst-uj1', 'dst-user', 'dst-a1', 'dst-j1', 'test'),
  ('dst-uj2', 'dst-user', 'dst-a1', 'dst-j2', 'test');
INSERT INTO documents (id, location, user_id, key, size, checksum) VALUES
  ('dst-d1', 'local', 'dst-user', 'k', 1, 'c');
INSERT INTO document_propositions (id, document_id, proposition_id, link_source) VALUES
  ('dst-dp1', 'dst-d1', 'dst-p1', 'user_manual'),
  ('dst-dp3', 'dst-d1', 'dst-p3', 'user_manual');
INSERT INTO email_correspondence (id, user_id, email_type, recipient_email, subject,
                                  representative_id, proposition_id) VALUES
  ('dst-e1', 'dst-user', 'representative_contact', 'office@example.test', 'Hello',
   'dst-r9', 'dst-p2');
INSERT INTO proposition_relevance_cache (id, user_id, proposition_id, expires_at) VALUES
  ('dst-c1', 'dst-user', 'dst-p1', now() + interval '1 day');
`;

/** Everything a failed swap must leave exactly as it was. */
const SNAPSHOT = `
SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'dp:' || id || ':' || proposition_id FROM public.document_propositions
  UNION ALL SELECT 'uj:' || id || ':' || jurisdiction_id FROM public.user_jurisdictions
  UNION ALL SELECT 'em:' || id || ':' || coalesce(representative_id, '') || ':' || coalesce(proposition_id, '')
    FROM public.email_correspondence
  UNION ALL SELECT 'u:' || id FROM public.users
  UNION ALL SELECT 'p:' || id FROM public.propositions
  UNION ALL SELECT 'j:' || id FROM public.jurisdictions
  UNION ALL SELECT 'c:' || id FROM public.proposition_relevance_cache
  UNION ALL SELECT 'fk:' || conname FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  UNION ALL SELECT 'staged:' || count(*) FROM pg_namespace WHERE nspname = 'corpus_staging'
) s(x)`;

describe('corpus transfer — integration (#1439)', () => {
  let dir: string;
  let manifestPath: string;
  let sha: string;
  const swap = (
    mode: 'check' | 'rehearse' | 'apply',
    manifest = manifestPath,
  ) =>
    runSwap(pg, {
      targetDb: DST,
      manifestPath: manifest,
      mode,
      lockTimeout: '5s',
    });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'corpus-transfer-it-'));
    await createMigrated(SRC);
    await createMigrated(DST);
    await pg.psql(SRC, SOURCE_SEED);
    await pg.psql(DST, TARGET_SEED);
  }, 300_000);

  afterAll(async () => {
    for (const db of [SRC, DST]) {
      await pg.psql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('exports the civic tables only, applying the #1429 D3 rule', async () => {
    const result = await runExport(pg, {
      sourceDb: SRC,
      outDir: dir,
      includeFinance: false,
      apply: true,
      gitSha: null,
      now: new Date(),
    });
    manifestPath = result.manifestPath!;
    sha = result.manifest!.dump.sha256;
    const toc = await pg.listArchive(join(dir, result.manifest!.dump.file));

    expect(toc).not.toMatch(/ TABLE DATA \S+ users /);
    expect(toc).not.toMatch(/ public /);
    expect(result.manifest!.rules.billSummaries).toEqual({
      present: 2,
      kept: 1,
      cleared: 1,
    });
    expect(result.manifest!.tables).toMatchObject({
      propositions: 2,
      bills: 2,
    });
    // The clone is gone.
    expect(
      await one(
        'template1',
        `SELECT count(*) FROM pg_database WHERE datname LIKE 'corpus_export_%'`,
      ),
    ).toBe('0');
  }, 120_000);

  it('stages it beside the live corpus, identical in definition', async () => {
    const result = await runStage(pg, {
      targetDb: DST,
      manifestPath,
      apply: true,
      replace: false,
      expectSha256: sha,
    });
    expect(result.differences).toEqual([]);
    expect(isReady(result)).toBe(true);
    expect(
      await one(
        DST,
        `SELECT ai_summary IS NULL FROM corpus_staging.bills WHERE id = 'src-b2'`,
      ),
    ).toBe('t');
    expect(
      await one(
        DST,
        `SELECT ai_summary IS NOT NULL FROM corpus_staging.bills WHERE id = 'src-b1'`,
      ),
    ).toBe('t');
  }, 120_000);

  it('refuses a petition link to a proposition UAT lacks, changing nothing', async () => {
    const before = await one(DST, SNAPSHOT);
    await expect(swap('apply')).rejects.toThrow(
      /1 document_propositions\.proposition_id reference\(s\) find no match/,
    );
    expect(await one(DST, SNAPSHOT)).toBe(before);

    await pg.psql(
      DST,
      `DELETE FROM document_propositions WHERE id = 'dst-dp3'`,
    );
  });

  it('rolls back completely when it fails after the tables have moved', async () => {
    // A manifest that disagrees with the staged counts fails the very last
    // check — after the drop, the move, the remaps and the key rebuild.
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as CorpusManifest;
    manifest.tables.bills += 1;
    const tampered = manifestPath.replace(
      '.manifest.json',
      '.tampered.manifest.json',
    );
    writeFileSync(tampered, JSON.stringify(manifest));

    const before = await one(DST, SNAPSHOT);
    await expect(swap('apply', tampered)).rejects.toThrow(
      /civic counts differ from the manifest: bills/,
    );
    expect(await one(DST, SNAPSHOT)).toBe(before);
  });

  it.each([
    [
      'a function over a civic row type',
      'CREATE FUNCTION public.probe_civic(b public.bills) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
      'DROP FUNCTION public.probe_civic(public.bills)',
      /would also have dropped: function/,
    ],
    [
      'an RLS policy on a user table that reads a civic one',
      'CREATE POLICY probe_policy ON public.documents USING (EXISTS (SELECT 1 FROM public.bills))',
      'DROP POLICY probe_policy ON public.documents',
      /would also have dropped: policy/,
    ],
  ])(
    'refuses a swap whose CASCADE would also drop %s, changing nothing',
    async (_label, create, drop, refusal) => {
      await pg.psql(DST, create);
      const before = await one(DST, SNAPSHOT);
      await expect(swap('apply')).rejects.toThrow(refusal);
      expect(await one(DST, SNAPSHOT)).toBe(before);
      await pg.psql(DST, drop);
    },
  );

  it('refuses a jurisdiction matched by FIPS whose OCD ID says otherwise', async () => {
    await pg.psql(
      DST,
      `UPDATE corpus_staging.jurisdictions SET ocd_id = 'ocd-division/x' WHERE id = 'src-j2';
       UPDATE public.jurisdictions SET ocd_id = 'ocd-division/y' WHERE id = 'dst-j2';`,
    );
    const before = await one(DST, SNAPSHOT);
    await expect(swap('apply')).rejects.toThrow(
      /1 user_jurisdictions\.jurisdiction_id reference\(s\) match only by a fallback key/,
    );
    expect(await one(DST, SNAPSHOT)).toBe(before);
    await pg.psql(
      DST,
      `UPDATE corpus_staging.jurisdictions SET ocd_id = NULL WHERE id = 'src-j2';
       UPDATE public.jurisdictions SET ocd_id = NULL WHERE id = 'dst-j2';`,
    );
  });

  it('rehearses every step and changes nothing', async () => {
    const before = await one(DST, SNAPSHOT);
    const result = await swap('rehearse');
    expect(result.committed).toBe(false);
    expect(result.report!.foreignKeysRecreated).toBeGreaterThan(0);
    expect(await one(DST, SNAPSHOT)).toBe(before);
  });

  it('swaps: corpus replaced, user references re-pointed, users untouched', async () => {
    const users = await one(
      DST,
      "SELECT string_agg(id, ',' ORDER BY id) FROM users",
    );
    const result = await swap('apply');

    expect(result.committed).toBe(true);
    expect(result.report).toMatchObject({
      remapped: {
        'document_propositions.proposition_id': 1,
        'user_jurisdictions.jurisdiction_id': 2,
        'email_correspondence.representative_id': 0,
        'email_correspondence.proposition_id': 1,
      },
      softUnmatched: {
        'email_correspondence.representative_id': 1,
        'email_correspondence.proposition_id': 0,
      },
      cachesEmptied: { proposition_relevance_cache: 1 },
    });

    // The corpus is UAT's, IDs and all.
    expect(
      await one(
        DST,
        `SELECT string_agg(id, ',' ORDER BY id) FROM propositions`,
      ),
    ).toBe('src-p1,src-p2');
    // A petition link and both jurisdictions (by OCD ID, then FIPS) followed.
    expect(
      await one(
        DST,
        `SELECT proposition_id FROM document_propositions WHERE id = 'dst-dp1'`,
      ),
    ).toBe('src-p1');
    expect(
      await one(
        DST,
        `SELECT string_agg(jurisdiction_id, ',' ORDER BY id) FROM user_jurisdictions`,
      ),
    ).toBe('src-j1,src-j2');
    expect(
      await one(
        DST,
        `SELECT proposition_id || ' ' || representative_id FROM email_correspondence`,
      ),
    ).toBe('src-p2 dst-r9');
    // Prod's users are prod's; UAT's never arrived.
    expect(
      await one(DST, "SELECT string_agg(id, ',' ORDER BY id) FROM users"),
    ).toBe(users);
    expect(
      await one(DST, `SELECT count(*) FROM proposition_relevance_cache`),
    ).toBe('0');
    // The foreign keys are back, and enforced.
    await expect(
      pg.psql(
        DST,
        `UPDATE document_propositions SET proposition_id = 'nope' WHERE id = 'dst-dp1'`,
      ),
    ).rejects.toThrow(/foreign key/);
    expect(
      await one(
        DST,
        `SELECT count(*) FROM pg_namespace WHERE nspname = 'corpus_staging'`,
      ),
    ).toBe('0');
  });

  it('refuses a staging whose definitions differ from the live tables', async () => {
    await runStage(pg, {
      targetDb: DST,
      manifestPath,
      apply: true,
      replace: false,
      expectSha256: sha,
    });
    await pg.psql(
      DST,
      `ALTER TABLE corpus_staging.bills ADD COLUMN extra text`,
    );
    await expect(swap('check')).rejects.toThrow(/1 definition difference/);
    await pg.psql(DST, dropStagingSql());
  });
});

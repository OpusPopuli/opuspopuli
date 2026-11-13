import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADMIN_DATABASE,
  prepareCloneSql,
  runExport,
  stamp,
  verifyArchive,
  type ExportOptions,
} from './export';
import { RefusalError, type PgRunner } from './pg';
import { CIVIC_TABLES, FINANCE_TABLES } from './tables';

/**
 * The export's guarantees that hold whatever the database says (#1439).
 * What its SQL does to real rows — the D3 rule, the clone, the dump — is
 * proven against Postgres in corpus-transfer.integration.spec.ts.
 */

const toc = (lines: string[]) =>
  [
    ';',
    '; Archive created at 2026-11-10',
    ';',
    '3; 2615 17000 SCHEMA - corpus_staging postgres',
    ...lines,
  ].join('\n');

const civicEntries = (
  type: 'TABLE' | 'TABLE DATA',
  tables: readonly string[],
) =>
  tables.map(
    (t, i) =>
      `${100 + i}; 1259 ${17001 + i} ${type} corpus_staging ${t} postgres`,
  );

const goodToc = () =>
  toc([
    ...civicEntries('TABLE', CIVIC_TABLES),
    ...civicEntries('TABLE DATA', CIVIC_TABLES),
    '900; 1259 18000 INDEX corpus_staging bills_pkey postgres',
    '901; 2606 18001 FK CONSTRAINT corpus_staging bill_votes bill_votes_bill_id_fkey postgres',
  ]);

describe('verifyArchive', () => {
  it('accepts exactly the civic tables in the staging schema', () => {
    expect(() => verifyArchive(goodToc())).not.toThrow();
  });

  it('refuses a user table, by name', () => {
    const withUsers = toc([
      ...civicEntries('TABLE', [...CIVIC_TABLES, 'users']),
      ...civicEntries('TABLE DATA', CIVIC_TABLES),
    ]);
    expect(() => verifyArchive(withUsers)).toThrow(/extra: users/);
  });

  it('refuses user rows even when the table definition is absent', () => {
    const withUserData = toc([
      ...civicEntries('TABLE', CIVIC_TABLES),
      ...civicEntries('TABLE DATA', [...CIVIC_TABLES, 'user_addresses']),
    ]);
    expect(() => verifyArchive(withUserData)).toThrow(
      /TABLE DATA entries differ.*extra: user_addresses/,
    );
  });

  it('refuses anything outside the staging schema', () => {
    const leaked = `${goodToc()}\n999; 1259 19000 TABLE public users postgres`;
    expect(() => verifyArchive(leaked)).toThrow(/1 entr\(ies\) outside/);
  });

  it.each([
    [
      'an entry in public merely named corpus_staging',
      '999; 1259 1 INDEX public corpus_staging postgres',
    ],
    [
      'an entry in public owned by a role called corpus_staging',
      '999; 1259 1 INDEX public users_email_idx corpus_staging',
    ],
    [
      'a function in the staging schema',
      '999; 1255 1 FUNCTION corpus_staging f() postgres',
    ],
    [
      'a rule in the staging schema',
      '999; 2618 1 RULE corpus_staging bills r postgres',
    ],
    ['a line that is not an entry at all', 'COPY public.users FROM stdin'],
  ])('refuses %s', (_label, line) => {
    expect(() => verifyArchive(`${goodToc()}\n${line}`)).toThrow(RefusalError);
  });

  it('accepts the schema, its grant and its comment', () => {
    const extra = [
      '5; 0 0 ACL - SCHEMA corpus_staging postgres',
      '6; 0 0 COMMENT - SCHEMA corpus_staging postgres',
      '7; 0 0 ACL corpus_staging TABLE bills postgres',
      '8; 0 0 COMMENT corpus_staging TABLE bills postgres',
    ].join('\n');
    expect(() => verifyArchive(`${goodToc()}\n${extra}`)).not.toThrow();
  });

  it('refuses a dump missing a civic table', () => {
    const short = CIVIC_TABLES.filter((t) => t !== 'bills');
    const missing = toc([
      ...civicEntries('TABLE', short),
      ...civicEntries('TABLE DATA', short),
    ]);
    expect(() => verifyArchive(missing)).toThrow(/missing: bills/);
  });
});

describe('prepareCloneSql', () => {
  it('moves every civic table, in one transaction', () => {
    const sql = prepareCloneSql(true);
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    for (const t of CIVIC_TABLES) {
      expect(sql).toContain(
        `ALTER TABLE public."${t}" SET SCHEMA "corpus_staging";`,
      );
    }
  });

  it('empties finance unless it is included (O4)', () => {
    expect(prepareCloneSql(true)).not.toContain('TRUNCATE');
    const truncate = /TRUNCATE ([^;]+);/.exec(prepareCloneSql(false))![1];
    expect(truncate.split(', ').sort()).toEqual(
      FINANCE_TABLES.map((t) => `public."${t}"`).sort(),
    );
  });

  it('never cascades a truncate into the rest of the corpus', () => {
    expect(prepareCloneSql(false)).not.toMatch(/CASCADE/i);
  });
});

describe('stamp', () => {
  it('is sortable and safe in a database name', () => {
    expect(stamp(new Date('2026-11-09T18:02:26.123Z'))).toBe('20261109180226');
  });
});

type Handler = (db: string, sql: string) => string[][] | Error;

function fakePg(handle: Handler, toc = goodToc()) {
  const calls: Array<{ db: string; sql: string }> = [];
  const pg: PgRunner = {
    psql: async (db, sql) => {
      calls.push({ db, sql });
      const out = handle(db, sql);
      if (out instanceof Error) throw out;
      return out;
    },
    dumpToFile: async (_db, _args, file) => writeFileSync(file, 'dump'),
    restoreFromFile: async () => undefined,
    listArchive: async () => toc,
  };
  return { pg, calls };
}

/** A healthy source: no unfinished migrations, all civic tables, idle. */
function healthy(
  sessions: string[][] = [],
  onPrepare?: () => Error | undefined,
  stale: string[] = [],
): Handler {
  return (db, sql) => {
    if (sql.includes('finished_at IS NULL')) return [['0']];
    if (sql.includes('SELECT migration_name')) return [['m1'], ['m2']];
    if (sql.includes('FROM pg_tables')) return CIVIC_TABLES.map((t) => [t]);
    if (sql.includes('pg_stat_activity')) return sessions;
    if (sql.includes("LIKE 'corpus")) return stale.map((d) => [d]);
    if (sql.includes('ai_summary IS NOT NULL),')) return [['10', '7']];
    if (sql.startsWith('BEGIN;')) return onPrepare?.() ?? [];
    if (sql.includes('UNION ALL')) return CIVIC_TABLES.map((t) => [t, '1']);
    return [];
  };
}

describe('runExport', () => {
  let outDir: string;
  const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({
    sourceDb: 'postgres',
    outDir,
    includeFinance: false,
    apply: true,
    gitSha: 'abc',
    now: new Date('2026-11-09T00:00:00Z'),
    ...over,
  });
  const created = (calls: Array<{ sql: string }>) =>
    calls.filter((c) => c.sql.startsWith('CREATE DATABASE')).length;
  const dropped = (calls: Array<{ db: string; sql: string }>) =>
    calls.filter(
      (c) => c.db === ADMIN_DATABASE && c.sql.startsWith('DROP DATABASE'),
    ).length;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'corpus-export-'));
  });

  it('writes nothing on a dry run', async () => {
    const { pg, calls } = fakePg(healthy([['client backend', '15']]));
    const result = await runExport(pg, options({ apply: false }));

    expect(result).toMatchObject({
      applied: false,
      migrations: 2,
      otherSessions: ['client backend: 15'],
      billSummaries: { present: 10, kept: 3, cleared: 7 },
    });
    expect(created(calls)).toBe(0);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('drops clones an interrupted export left, before anything else', async () => {
    const { pg, calls } = fakePg(
      healthy([], undefined, ['corpus_export_20261101000000']),
    );
    const dry = await runExport(pg, options({ apply: false }));
    expect(dry.staleClones).toEqual(['corpus_export_20261101000000']);
    expect(dropped(calls)).toBe(0);

    await runExport(pg, options());
    const drops = calls.filter((c) => c.sql.startsWith('DROP DATABASE'));
    expect(drops[0].sql).toContain('"corpus_export_20261101000000"');
    expect(
      calls.findIndex((c) => c.sql.startsWith('DROP DATABASE')),
    ).toBeLessThan(calls.findIndex((c) => c.sql.startsWith('CREATE DATABASE')));
  });

  it('keeps the original error when the clone cannot be dropped', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { pg } = fakePg((db, sql) => {
      if (sql.startsWith('DROP DATABASE')) return new Error('drop failed');
      return healthy([], () => new Error('boom'))(db, sql);
    });
    await expect(runExport(pg, options())).rejects.toThrow('boom');
    expect(error.mock.calls.join()).toMatch(/could not drop the clone/);
    error.mockRestore();
  });

  it('refuses to clone a source other sessions are using', async () => {
    const { pg, calls } = fakePg(healthy([['client backend', '3']]));
    await expect(runExport(pg, options())).rejects.toThrow(
      /client backend: 3.*stop the stack's services/,
    );
    expect(created(calls)).toBe(0);
  });

  it('advises waiting, not a restart, for any other kind of backend', async () => {
    const { pg } = fakePg(healthy([['parallel worker', '2']]));
    const refusal = runExport(pg, options());
    await expect(refusal).rejects.toThrow(/wait for the other backends/);
    await expect(refusal).rejects.not.toThrow(/cron\.database_name/);
  });

  it('never counts autovacuum workers, which the clone signals away', async () => {
    const { pg, calls } = fakePg(healthy());
    await runExport(pg, options({ apply: false }));
    const query = calls.find((c) => c.sql.includes('pg_stat_activity'));
    expect(query?.sql).toContain("backend_type <> 'autovacuum worker'");
  });

  // 2026-11-13: pg_cron and pg_net pinned UAT with no client connected.
  it('refuses a source background workers hold, saying how to free it', async () => {
    const { pg, calls } = fakePg(
      healthy([
        ['pg_cron launcher', '1'],
        ['pg_net 0.20.0 worker', '1'],
      ]),
    );
    const dry = await runExport(pg, options({ apply: false }));
    expect(dry.otherSessions).toEqual([
      'pg_cron launcher: 1',
      'pg_net 0.20.0 worker: 1',
    ]);
    await expect(runExport(pg, options())).rejects.toThrow(
      /cron\.database_name and pg_net\.database_name/,
    );
    expect(created(calls)).toBe(0);
  });

  it('refuses a source with a table no class names', async () => {
    const { pg } = fakePg((db, sql) =>
      sql.includes('FROM pg_tables')
        ? [...CIVIC_TABLES.map((t) => [t]), ['mystery']]
        : healthy()(db, sql),
    );
    await expect(runExport(pg, options())).rejects.toThrow(/mystery/);
  });

  it('refuses a source with a migration left half-applied', async () => {
    const { pg } = fakePg((db, sql) =>
      sql.includes('finished_at IS NULL') ? [['1']] : healthy()(db, sql),
    );
    await expect(runExport(pg, options())).rejects.toThrow(/not finished/);
  });

  it('writes the dump and a manifest, then drops the clone', async () => {
    const { pg, calls } = fakePg(healthy());
    const result = await runExport(pg, options());

    expect(result.applied).toBe(true);
    expect(result.manifest).toMatchObject({
      format: 'opuspopuli-corpus/1',
      migrations: ['m1', 'm2'],
      includeFinance: false,
      dump: { file: 'corpus-20261109000000.dump', bytes: 4 },
    });
    expect(Object.keys(result.manifest!.tables)).toHaveLength(
      CIVIC_TABLES.length,
    );
    expect(existsSync(result.manifestPath!)).toBe(true);
    expect(dropped(calls)).toBe(1);
  });

  it('drops the clone when preparing it fails', async () => {
    const { pg, calls } = fakePg(healthy([], () => new Error('boom')));
    await expect(runExport(pg, options())).rejects.toThrow('boom');
    expect(created(calls)).toBe(1);
    expect(dropped(calls)).toBe(1);
  });

  it('deletes a dump that fails its check, and drops the clone', async () => {
    const leaky = `${goodToc()}\n999; 1259 19000 TABLE public users postgres`;
    const { pg, calls } = fakePg(healthy(), leaky);
    await expect(runExport(pg, options())).rejects.toThrow(/outside/);
    expect(readdirSync(outDir)).toEqual([]);
    expect(dropped(calls)).toBe(1);
  });
});

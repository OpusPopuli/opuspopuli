import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CorpusManifest } from './manifest';
import { RefusalError, type PgRunner } from './pg';
import {
  countMismatches,
  isReady,
  migrationDifferences,
  runStage,
  type StageOptions,
} from './stage';
import { CIVIC_TABLES } from './tables';

describe('migrationDifferences', () => {
  it('names the migrations on one side only', () => {
    expect(migrationDifferences(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      'only in dump: b',
      'only on target: d',
    ]);
  });

  it('finds none when the lists match', () => {
    expect(migrationDifferences(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('countMismatches', () => {
  it('names each table whose staged count differs, or is missing', () => {
    expect(
      countMismatches({ bills: 2, votes: 5, x: 1 }, { bills: 2, votes: 4 }),
    ).toEqual([
      'votes: manifest 5, staged 4',
      'x: manifest 1, staged undefined',
    ]);
  });
});

const toc = [
  '3; 2615 1 SCHEMA - corpus_staging postgres',
  ...CIVIC_TABLES.map(
    (t, i) => `${10 + i}; 1259 ${i} TABLE corpus_staging ${t} postgres`,
  ),
  ...CIVIC_TABLES.map(
    (t, i) => `${90 + i}; 0 ${i} TABLE DATA corpus_staging ${t} postgres`,
  ),
].join('\n');

interface World {
  migrations: string[];
  stagingExists: boolean;
  dependencies: string[];
  stagedDefinition: string;
  stagedRows: number;
}

function fakePg(world: World) {
  const restored: string[][] = [];
  const statements: string[] = [];
  const pg: PgRunner = {
    psql: async (_db, sql) => {
      statements.push(sql);
      if (sql.includes('finished_at IS NULL')) return [['0']];
      if (sql.includes('SELECT migration_name'))
        return world.migrations.map((m) => [m]);
      if (sql.includes('FROM pg_tables')) return CIVIC_TABLES.map((t) => [t]);
      if (sql.includes('FROM pg_catalog.pg_namespace WHERE')) {
        return world.stagingExists ? [['1']] : [];
      }
      if (sql.includes("'view '")) return world.dependencies.map((d) => [d]);
      if (sql.includes('corpus_reparse_check')) {
        const staged = sql.includes("n.nspname = 'corpus_staging'");
        return [
          [
            'bills',
            'column',
            'id',
            staged ? world.stagedDefinition : '#1 text',
          ],
        ];
      }
      if (sql.includes('UNION ALL')) {
        return CIVIC_TABLES.map((t) => [t, String(world.stagedRows)]);
      }
      return [];
    },
    dumpToFile: async () => undefined,
    restoreFromFile: async (_db, args) => {
      restored.push(args);
    },
    listArchive: async () => toc,
  };
  return { pg, restored, statements };
}

describe('runStage', () => {
  let dir: string;
  const healthy = (): World => ({
    migrations: ['m1', 'm2'],
    stagingExists: false,
    dependencies: [],
    stagedDefinition: '#1 text',
    stagedRows: 3,
  });

  function writeDump(
    contents = 'dump-bytes',
    over: Partial<CorpusManifest> = {},
  ) {
    writeFileSync(join(dir, 'corpus.dump'), contents);
    const manifest: CorpusManifest = {
      format: 'opuspopuli-corpus/1',
      createdAt: '2026-11-09T00:00:00Z',
      gitSha: null,
      sourceDatabase: 'postgres',
      migrations: ['m1', 'm2'],
      includeFinance: false,
      tables: Object.fromEntries(CIVIC_TABLES.map((t) => [t, 3])),
      rules: { billSummaries: { present: 0, kept: 0, cleared: 0 } },
      dump: {
        file: 'corpus.dump',
        bytes: contents.length,
        sha256: createHash('sha256').update('dump-bytes').digest('hex'),
      },
      ...over,
    };
    const path = join(dir, 'corpus.dump.manifest.json');
    writeFileSync(path, JSON.stringify(manifest));
    return path;
  }

  const options = (
    manifestPath: string,
    over: Partial<StageOptions> = {},
  ): StageOptions => ({
    targetDb: 'postgres',
    manifestPath,
    apply: true,
    replace: false,
    ...over,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'corpus-stage-'));
  });

  it('stages an identical corpus and calls it ready', async () => {
    const { pg, restored } = fakePg(healthy());
    const result = await runStage(pg, options(writeDump()));
    expect(isReady(result)).toBe(true);
    expect(restored).toEqual([['--single-transaction', '--exit-on-error']]);
  });

  it('restores nothing on a dry run', async () => {
    const { pg, restored } = fakePg(healthy());
    const result = await runStage(pg, options(writeDump(), { apply: false }));
    expect(result.applied).toBe(false);
    expect(isReady(result)).toBe(false);
    expect(restored).toEqual([]);
  });

  it('refuses a dump that is not the one the manifest describes', async () => {
    const { pg, restored } = fakePg(healthy());
    await expect(runStage(pg, options(writeDump('tampered')))).rejects.toThrow(
      /checksum/,
    );
    expect(restored).toEqual([]);
  });

  it('refuses a target on other migrations', async () => {
    const { pg, restored } = fakePg({ ...healthy(), migrations: ['m1', 'm3'] });
    await expect(runStage(pg, options(writeDump()))).rejects.toThrow(
      /only in dump: m2; only on target: m3/,
    );
    expect(restored).toEqual([]);
  });

  it('refuses to restage over an existing staging unless told to', async () => {
    const world = { ...healthy(), stagingExists: true };
    const { pg, restored } = fakePg(world);
    await expect(runStage(pg, options(writeDump()))).rejects.toThrow(
      /--replace/,
    );
    expect(restored).toEqual([]);

    const again = fakePg(world);
    await runStage(again.pg, options(writeDump(), { replace: true }));
    expect(again.statements.some((s) => s.includes('DROP SCHEMA'))).toBe(true);
    expect(again.restored).toHaveLength(1);
  });

  it('refuses to restore when the target has objects a swap would break', async () => {
    const { pg, restored } = fakePg({
      ...healthy(),
      dependencies: ['view public.v reads public.bills'],
    });
    await expect(runStage(pg, options(writeDump()))).rejects.toThrow(
      RefusalError,
    );
    expect(restored).toEqual([]);
  });

  it('refuses to restore an archive holding anything else', async () => {
    const { pg, restored } = fakePg(healthy());
    pg.listArchive = async () =>
      `${toc}\n999; 1259 9 TABLE public users postgres`;
    await expect(runStage(pg, options(writeDump()))).rejects.toThrow(/outside/);
    expect(restored).toEqual([]);
  });

  it('is not ready when a definition differs', async () => {
    const { pg } = fakePg({ ...healthy(), stagedDefinition: '#1 varchar' });
    const result = await runStage(pg, options(writeDump()));
    expect(result.differences).toEqual([
      'differs: bills|column|id: #1 text <> #1 varchar',
    ]);
    expect(isReady(result)).toBe(false);
  });

  it('is not ready when a row count differs', async () => {
    const { pg } = fakePg({ ...healthy(), stagedRows: 2 });
    const result = await runStage(pg, options(writeDump()));
    expect(result.countMismatches).toHaveLength(CIVIC_TABLES.length);
    expect(isReady(result)).toBe(false);
  });
});

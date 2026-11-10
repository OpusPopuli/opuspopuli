import type { CorpusManifest } from './manifest';
import type { PgRunner } from './pg';
import { parseReport, refuseIf, remapSql, runSwap, swapSql } from './swap';
import { CIVIC_TABLES, REMAPPED_REFERENCES } from './tables';

/**
 * The swap script's shape (#1439). What it does to real tables — remaps,
 * refusals, the rollback after a late failure, the rehearsal — is proven in
 * corpus-transfer.integration.spec.ts, each case mutation-checked.
 */

const manifest = {
  tables: Object.fromEntries(CIVIC_TABLES.map((t) => [t, 1])),
} as unknown as CorpusManifest;
const script = (commit: boolean) =>
  swapSql({ manifest, userTables: ['users'], lockTimeout: '5s', commit });

describe('swapSql', () => {
  it('is one transaction that fails fast on a lock', () => {
    const sql = script(true);
    expect(sql.startsWith('BEGIN;\n')).toBe(true);
    expect(sql).toContain(`SET LOCAL lock_timeout = '5s';`);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.match(/\bBEGIN;/g)).toHaveLength(1);
  });

  it('rolls back when rehearsing', () => {
    const sql = script(false);
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(sql).not.toContain('COMMIT;');
  });

  it('drops only civic tables, and truncates nothing but caches', () => {
    const sql = script(true);
    const dropped = /DROP TABLE ([^;]+) CASCADE;/.exec(sql)![1].split(', ');
    expect(dropped.sort()).toEqual(
      CIVIC_TABLES.map((t) => `public."${t}"`).sort(),
    );
    expect(sql.match(/DROP TABLE/g)).toHaveLength(1);
    expect(/TRUNCATE ([^;]+);/.exec(sql)![1]).not.toMatch(
      /"users"|"documents"/,
    );
  });

  it('refuses an unmatched foreign-key reference for each remap', () => {
    const sql = script(true);
    for (const r of REMAPPED_REFERENCES) {
      expect(sql).toContain(
        `${r.table}.${r.column} reference(s) find no match`,
      );
    }
  });
});

describe('remapSql', () => {
  it('tries each natural key in order', () => {
    const jurisdictions = REMAPPED_REFERENCES.find(
      (r) => r.target === 'jurisdictions',
    )!;
    const sql = remapSql(jurisdictions);
    expect(sql).toContain('THEN k0.id WHEN k1.id IS NOT NULL');
    expect(sql).toContain('k0."ocd_id" = l."ocd_id"');
    expect(sql).toContain('k1."fips_code" = l."fips_code"');
  });
});

describe('remapSql identity', () => {
  it('rejects a fallback match that contradicts an earlier key', () => {
    const jurisdictions = REMAPPED_REFERENCES.find(
      (r) => r.target === 'jurisdictions',
    )!;
    const sql = remapSql(jurisdictions);
    // Matched by FIPS, but both rows carry an OCD ID and they differ.
    expect(sql).toContain(
      '(l."ocd_id" IS NOT NULL AND k1."ocd_id" IS NOT NULL AND (l."ocd_id") IS DISTINCT FROM (k1."ocd_id"))',
    );
    expect(sql).toContain('AS conflict');
  });
});

describe('refuseIf', () => {
  it('raises a refusal, passing its arguments', () => {
    expect(refuseIf('x > 0', '% rows', 'x')).toContain(
      `RAISE EXCEPTION 'refused: % rows', x;`,
    );
  });
});

describe('parseReport', () => {
  it('finds the JSON line among other output', () => {
    expect(parseReport([['DO'], ['{"foreignKeysRecreated": 3}']])).toEqual({
      foreignKeysRecreated: 3,
    });
  });

  it('fails loudly when there is none', () => {
    expect(() => parseReport([['DO']])).toThrow(/no report/);
  });
});

describe('runSwap', () => {
  it('refuses a lock timeout that is not a duration, before touching anything', async () => {
    const psql = jest.fn();
    const pg = { psql } as unknown as PgRunner;
    await expect(
      runSwap(pg, {
        targetDb: 'postgres',
        manifestPath: '/nonexistent',
        mode: 'apply',
        lockTimeout: "5s'; DROP TABLE users; --",
      }),
    ).rejects.toThrow(/lock timeout/);
    expect(psql).not.toHaveBeenCalled();
  });

  it('refuses a zero lock timeout, which would mean wait for ever', async () => {
    const psql = jest.fn();
    await expect(
      runSwap({ psql } as unknown as PgRunner, {
        targetDb: 'postgres',
        manifestPath: '/nonexistent',
        mode: 'apply',
        lockTimeout: '0s',
      }),
    ).rejects.toThrow(/positive/);
    expect(psql).not.toHaveBeenCalled();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CACHE_TABLES,
  CIVIC_TABLES,
  FINANCE_TABLES,
  INFRA_TABLES,
  REMAPPED_REFERENCES,
  SEED_TABLES,
  USER_TABLES,
  classOf,
  isFinanceTable,
  unclassifiedTables,
} from './tables';

/**
 * The table classes checked against the schema itself, not a copy of it
 * (#1439). Each test here guards an assumption the swap relies on; when
 * one fails, the schema has changed in a way the transfer must be taught
 * about before it runs again.
 */

const SCHEMA = readFileSync(
  resolve(
    __dirname,
    '../../../../packages/relationaldb-provider/prisma/schema.prisma',
  ),
  'utf8',
);

interface Model {
  table: string;
  /** Prisma field name → column name. */
  columns: Map<string, string>;
  /** Column sets that are unique, from `@unique` and `@@unique`. */
  uniques: string[][];
  body: string;
}

interface ForeignKey {
  table: string;
  columns: string[];
  targetModel: string;
}

function parseModels(schema: string): Map<string, Model> {
  const models = new Map<string, Model>();
  for (const [, name, body] of schema.matchAll(
    /^model (\w+) \{([\s\S]*?)^\}/gm,
  )) {
    const columns = new Map<string, string>();
    const uniques: string[][] = [];
    for (const line of body.split('\n')) {
      const field = /^\s{2}(\w+)\s+\S/.exec(line)?.[1];
      if (!field) continue;
      const column = /@map\("([^"]+)"\)/.exec(line)?.[1] ?? field;
      columns.set(field, column);
      if (/@unique\b/.test(line)) uniques.push([column]);
    }
    for (const [, fields] of body.matchAll(/@@unique\(\[([^\]]+)\]/g)) {
      uniques.push(
        fields.split(',').map((f) => columns.get(f.trim()) ?? f.trim()),
      );
    }
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name;
    models.set(name, { table, columns, uniques, body });
  }
  return models;
}

function foreignKeys(models: Map<string, Model>): ForeignKey[] {
  const keys: ForeignKey[] = [];
  for (const model of models.values()) {
    for (const line of model.body.split('\n')) {
      const m =
        /^\s{2}\w+\s+(\w+)\??\s.*@relation\(.*fields:\s*\[([^\]]+)\]/.exec(
          line,
        );
      if (!m) continue;
      keys.push({
        table: model.table,
        columns: m[2].split(',').map((f) => model.columns.get(f.trim())!),
        targetModel: m[1],
      });
    }
  }
  return keys;
}

const MODELS = parseModels(SCHEMA);
const TABLES = [...MODELS.values()].map((m) => m.table);
const tableOf = (model: string): string => MODELS.get(model)!.table;
const EDGES = foreignKeys(MODELS).map((fk) => ({
  ...fk,
  target: tableOf(fk.targetModel),
}));

/** Tables in the classes that no Prisma model defines, each on purpose. */
const NOT_IN_PRISMA = ['default_embeddings_vectors', ...INFRA_TABLES];

const ALL_CLASSIFIED = [
  ...CIVIC_TABLES,
  ...USER_TABLES,
  ...CACHE_TABLES,
  ...SEED_TABLES,
  ...INFRA_TABLES,
];

describe('corpus-transfer table classes (#1439)', () => {
  it('reads the schema it is checking', () => {
    // A parser that matched nothing would pass every test below.
    expect(TABLES.length).toBeGreaterThan(70);
    expect(EDGES.length).toBeGreaterThan(90);
  });

  it('places every Prisma table in a class', () => {
    expect(unclassifiedTables(TABLES)).toEqual([]);
  });

  it('places no table in two classes', () => {
    const seen = new Set<string>();
    const twice = ALL_CLASSIFIED.filter((t) => seen.size === seen.add(t).size);
    expect(twice).toEqual([]);
  });

  it('lists no table the schema has dropped', () => {
    const known = new Set([...TABLES, ...NOT_IN_PRISMA]);
    expect(ALL_CLASSIFIED.filter((t) => !known.has(t))).toEqual([]);
  });

  it('exports nothing that points at personal data', () => {
    // A civic row holding a user ID would carry UAT's users into prod.
    const civic = new Set<string>(CIVIC_TABLES);
    const leaks = EDGES.filter(
      (e) => civic.has(e.table) && !civic.has(e.target),
    ).map((e) => `${e.table} -> ${e.target}`);
    expect(leaks).toEqual([]);
  });

  it('remaps exactly the references kept data holds into the corpus', () => {
    // Caches are emptied, so their references don't matter. Anything else
    // that points into a replaced table must be re-pointed by natural key,
    // or the swap's constraint rebuild fails in the window.
    const kept = new Set<string>([...USER_TABLES, ...SEED_TABLES]);
    const civic = new Set<string>(CIVIC_TABLES);
    const found = EDGES.filter((e) => kept.has(e.table) && civic.has(e.target))
      .map((e) => `${e.table}.${e.columns.join(',')} -> ${e.target}`)
      .sort();
    const declared = REMAPPED_REFERENCES.map(
      (r) => `${r.table}.${r.column} -> ${r.target}`,
    ).sort();
    expect(found).toEqual(declared);
  });

  it.each(
    REMAPPED_REFERENCES.flatMap((r) =>
      r.naturalKeys.map((k): [string, readonly string[]] => [r.target, k]),
    ),
  )('matches %s by a unique key (%s)', (target, key) => {
    const model = [...MODELS.values()].find((m) => m.table === target)!;
    const unique = model.uniques.some(
      (u) => u.length === key.length && key.every((c) => u.includes(c)),
    );
    expect(unique).toBe(true);
  });

  it('lets finance be emptied without breaking the rest of the corpus', () => {
    // Nothing outside finance points into it. The reverse is not true —
    // finance references propositions, representatives and pipeline
    // executions — which is why finance can be shipped empty or whole, but
    // prod's old finance cannot be kept beside a replaced corpus.
    const intoFinance = EDGES.filter(
      (e) => isFinanceTable(e.target) && !isFinanceTable(e.table),
    ).map((e) => `${e.table} -> ${e.target}`);
    expect(intoFinance).toEqual([]);
  });

  it('keeps finance inside the civic class', () => {
    const civic = new Set<string>(CIVIC_TABLES);
    expect(FINANCE_TABLES.filter((t) => !civic.has(t))).toEqual([]);
  });
});

describe('classOf / unclassifiedTables', () => {
  it('classifies each kind of table', () => {
    expect(classOf('bills')).toBe('civic');
    expect(classOf('contributions')).toBe('civic');
    expect(classOf('users')).toBe('user');
    expect(classOf('default_embeddings_vectors')).toBe('user');
    expect(classOf('bill_relevance_cache')).toBe('cache');
    expect(classOf('prompt_templates')).toBe('seed');
    expect(classOf('_prisma_migrations')).toBe('infra');
    expect(classOf('something_new')).toBeUndefined();
  });

  it('names the unknown tables, sorted', () => {
    expect(
      unclassifiedTables(['bills', 'zeta_vectors', 'users', 'alpha']),
    ).toEqual(['alpha', 'zeta_vectors']);
  });
});

import {
  catalogSql,
  dependencySql,
  columnOrderNotes,
  diffCatalogs,
  dropStagingSql,
  toCatalog,
} from './catalog';

/**
 * The comparison's logic (#1439). That its SQL describes real tables — and
 * that a dump round trip compares equal while a real change does not — was
 * verified against Postgres 17 on 2026-11-09 (plan §4.2) and is covered by
 * corpus-transfer.integration.spec.ts.
 */

describe('toCatalog', () => {
  it('keys by table, kind and name, and normalises the staged schema', () => {
    const catalog = toCatalog(
      [
        [
          'bills',
          'index',
          'bills_pkey',
          'CREATE UNIQUE INDEX bills_pkey ON corpus_staging.bills USING btree (id)',
        ],
        [
          'bill_votes',
          'constraint',
          'fk',
          'f FOREIGN KEY (bill_id) REFERENCES corpus_staging.bills(id)',
        ],
      ],
      'corpus_staging',
    );
    expect(catalog.get('bills|index|bills_pkey')).toBe(
      'CREATE UNIQUE INDEX bills_pkey ON public.bills USING btree (id)',
    );
    expect(catalog.get('bill_votes|constraint|fk')).toContain(
      'REFERENCES public.bills(id)',
    );
  });

  it('does not rewrite a schema name that is only a prefix of a word', () => {
    const catalog = toCatalog(
      [['t', 'column', 'c', "DEFAULT 'my_corpus_staging.x'::text"]],
      'corpus_staging',
    );
    expect(catalog.get('t|column|c')).toBe(
      "DEFAULT 'my_corpus_staging.x'::text",
    );
  });
});

describe('diffCatalogs', () => {
  const live = new Map([
    ['bills|column|id', 'text NOT NULL'],
    ['bills|index|bills_pkey', 'CREATE UNIQUE INDEX …'],
    ['bills|table|grants', 'grafana_ro=r/postgres'],
  ]);

  it('finds nothing when the twins match', () => {
    expect(diffCatalogs(live, new Map(live))).toEqual([]);
  });

  it('names what is missing, extra or changed', () => {
    const staged = new Map(live);
    staged.delete('bills|index|bills_pkey');
    staged.set('bills|column|extra', 'text');
    staged.set('bills|table|grants', '');
    expect(diffCatalogs(live, staged)).toEqual([
      'differs: bills|table|grants: grafana_ro=r/postgres <> ',
      'only live: bills|index|bills_pkey',
      'only staged: bills|column|extra',
    ]);
  });
});

describe('column order', () => {
  const live = new Map([
    ['bills|column|a', 'text'],
    ['bills|column|b', 'text'],
    ['bills|column-order|columns', 'a,b'],
  ]);

  it('is not a definition difference', () => {
    const staged = new Map(live).set('bills|column-order|columns', 'b,a');
    expect(diffCatalogs(live, staged)).toEqual([]);
  });

  it('is reported, naming the positions that moved', () => {
    const staged = new Map(live).set('bills|column-order|columns', 'b,a');
    expect(columnOrderNotes(live, staged)).toEqual([
      'bills: #1 a <> b, #2 b <> a',
    ]);
  });

  it('is not reported when the columns themselves differ', () => {
    const staged = new Map(live)
      .set('bills|column|c', 'text')
      .set('bills|column-order|columns', 'a,b,c');
    expect(columnOrderNotes(live, staged)).toEqual([]);
    expect(diffCatalogs(live, staged)).toEqual(['only staged: bills|column|c']);
  });

  it('still refuses a column whose definition changed', () => {
    const staged = new Map(live).set('bills|column|b', 'integer');
    expect(diffCatalogs(live, staged)).toEqual([
      'differs: bills|column|b: text <> integer',
    ]);
  });
});

describe('the catalog query', () => {
  const sql = catalogSql('corpus_staging');

  it('keeps column position out of each column, in its own entry', () => {
    expect(sql).toContain("'column-order', 'columns'");
    expect(sql).not.toContain('row_number()');
  });

  it('qualifies every name, so the schemas can be compared', () => {
    expect(sql.startsWith("SET search_path = '';")).toBe(true);
  });

  it.each([
    'column',
    'index',
    'constraint',
    "'owner'",
    "'grants'",
    "'options'",
  ])('describes %s', (kind) => {
    expect(sql).toContain(kind);
  });

  it('compares CHECK constraints after the same round trip a dump gives them', () => {
    expect(sql).toContain('pg_temp.corpus_reparse_check(');
  });
});

describe('dependencySql', () => {
  it.each([
    'view ',
    'trigger ',
    'policy ',
    'publication ',
    'foreign key ',
    'sequence ',
  ])('looks for a %s', (kind) => {
    expect(dependencySql()).toContain(`'${kind}`);
  });
});

describe('dropStagingSql', () => {
  it('never cascades', () => {
    expect(dropStagingSql()).not.toMatch(/CASCADE/i);
    expect(dropStagingSql()).toContain('DROP SCHEMA "corpus_staging" RESTRICT');
  });

  it('drops only the staging schema', () => {
    expect(dropStagingSql()).not.toMatch(/public\./);
  });
});

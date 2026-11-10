/**
 * Comparing table definitions, and finding what a swap would break (#1439).
 *
 * The swap replaces each live civic table with its staged twin by moving
 * the staged one into `public`. That is only a like-for-like replacement if
 * the twins are defined identically — same columns, types, defaults,
 * indexes, constraints, owner and grants — and if nothing outside the civic
 * set depends on the live table's identity. This file answers both, from
 * the catalog, without reading a row.
 */
import { STAGING_SCHEMA } from './manifest';
import { ident, literal, type PgRunner } from './pg';
import { CIVIC_TABLES } from './tables';

/** `table|kind|name` → definition, schema-qualified, normalised to `public`. */
export type Catalog = Map<string, string>;

const tableList = (): string =>
  `ARRAY[${CIVIC_TABLES.map(literal).join(', ')}]::text[]`;

/**
 * A CHECK constraint's text as Postgres prints it after one more parse.
 *
 * Dumping prints a constraint and restoring parses that text again, and
 * Postgres does not always print the result the same way: on 2026-11-09 a
 * `col::text = ANY ((ARRAY['a'::varchar, …])::text[])` came back as
 * `ANY (ARRAY[('a'::varchar)::text, …])` — the same check, different text.
 * Rather than loosen the comparison, both sides get the same round trip:
 * the constraint is added, from its printed text, to a scratch copy of its
 * table's columns, and read back. Printing is stable after one round, so a
 * staged constraint is unchanged by this and a live one reaches the same
 * canonical form; a real difference still differs.
 */
const REPARSE_FUNCTION = `CREATE OR REPLACE FUNCTION pg_temp.corpus_reparse_check(rel pg_catalog.oid, def pg_catalog.text)
RETURNS pg_catalog.text LANGUAGE plpgsql AS $$
DECLARE
  printed pg_catalog.text;
BEGIN
  EXECUTE pg_catalog.format('CREATE TEMP TABLE corpus_probe (LIKE %s)', rel::pg_catalog.regclass);
  EXECUTE pg_catalog.format('ALTER TABLE pg_temp.corpus_probe ADD CONSTRAINT probe %s NOT VALID', def);
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO printed
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'pg_temp.corpus_probe'::pg_catalog.regclass AND conname = 'probe';
  DROP TABLE pg_temp.corpus_probe;
  RETURN pg_catalog.regexp_replace(printed, ' NOT VALID$', '');
END
$$;`;

/**
 * Every definition that makes a civic table what it is.
 *
 * Run with an empty `search_path`, so both schemas print every name
 * qualified and the staged side can be normalised by replacing its schema.
 * Whitespace is collapsed so a definition is always one field.
 */
export function catalogSql(schema: string): string {
  const one = (expr: string) =>
    String.raw`regexp_replace(${expr}, '\s+', ' ', 'g')`;
  return `SET search_path = '';
${REPARSE_FUNCTION}
WITH t AS (
  SELECT c.oid, c.relname, c.relowner, c.relacl, c.relpersistence,
         c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions,
         c.relkind
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${literal(schema)} AND c.relname = ANY(${tableList()})
)
SELECT t.relname, 'column', a.attname, ${one(`concat_ws(' ',
    '#' || row_number() OVER (PARTITION BY t.relname ORDER BY a.attnum),
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    CASE WHEN a.attnotnull THEN 'NOT NULL' END,
    'DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid),
    NULLIF('identity:' || a.attidentity::text, 'identity:'),
    NULLIF('generated:' || a.attgenerated::text, 'generated:'),
    'collation:' || NULLIF(a.attcollation, 0)::pg_catalog.regcollation::text,
    'acl:' || a.attacl::text)`)}
FROM t
JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
UNION ALL
SELECT t.relname, 'index', ic.relname, ${one('pg_catalog.pg_get_indexdef(i.indexrelid)')}
FROM t
JOIN pg_catalog.pg_index i ON i.indrelid = t.oid
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
UNION ALL
SELECT t.relname, 'constraint', co.conname, ${one(`co.contype::text || ' ' ||
    CASE WHEN co.contype = 'c'
      THEN pg_temp.corpus_reparse_check(t.oid, pg_catalog.pg_get_constraintdef(co.oid))
      ELSE pg_catalog.pg_get_constraintdef(co.oid) END ||
    CASE WHEN co.convalidated THEN '' ELSE ' NOT VALID' END`)}
FROM t
JOIN pg_catalog.pg_constraint co ON co.conrelid = t.oid
UNION ALL
SELECT t.relname, 'table', 'owner', pg_catalog.pg_get_userbyid(t.relowner)::text
FROM t
UNION ALL
SELECT t.relname, 'table', 'grants', coalesce(
    (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(t.relacl) x), '')
FROM t
UNION ALL
SELECT t.relname, 'table', 'options', concat_ws(' ',
    'kind:' || t.relkind::text, 'persistence:' || t.relpersistence::text,
    'rls:' || t.relrowsecurity::text, 'force-rls:' || t.relforcerowsecurity::text,
    'replica-identity:' || t.relreplident::text, 'reloptions:' || t.reloptions::text)
FROM t;`;
}

/** Rows from {@link catalogSql}, keyed, with the schema normalised away. */
export function toCatalog(rows: string[][], schema: string): Catalog {
  const qualified = new RegExp(String.raw`\b${schema}\.`, 'g');
  return new Map(
    rows.map(([table, kind, name, def]) => [
      `${table}|${kind}|${name}`,
      def.replace(qualified, 'public.'),
    ]),
  );
}

export async function readCatalog(
  pg: PgRunner,
  db: string,
  schema: string,
): Promise<Catalog> {
  return toCatalog(await pg.psql(db, catalogSql(schema)), schema);
}

/**
 * Every way `staged` differs from `live`, one line each, naming the table
 * and the object. Definitions only: there is no row data in a catalog.
 */
export function diffCatalogs(live: Catalog, staged: Catalog): string[] {
  const out: string[] = [];
  for (const [key, def] of live) {
    const other = staged.get(key);
    if (other === undefined) out.push(`only live: ${key}`);
    else if (other !== def) out.push(`differs: ${key}: ${def} <> ${other}`);
  }
  for (const key of staged.keys()) {
    if (!live.has(key)) out.push(`only staged: ${key}`);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * What would make `DROP TABLE public.<civic> CASCADE` do more than drop the
 * foreign keys the swap records and rebuilds (§4.3 step 6), or would be
 * silently lost with the dropped table. Any finding is a refusal.
 */
export function dependencySql(): string {
  const civic = `(SELECT c.oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', ${literal(STAGING_SCHEMA)})
        AND c.relname = ANY(${tableList()}))`;
  return `SET search_path = '';
SELECT 'view ' || v.oid::pg_catalog.regclass::text || ' reads ' || d.refobjid::pg_catalog.regclass::text
FROM pg_catalog.pg_depend d
JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
JOIN pg_catalog.pg_class v ON v.oid = r.ev_class
WHERE d.refobjid IN ${civic} AND r.ev_class <> d.refobjid
UNION
SELECT 'trigger ' || tg.tgname || ' on ' || tg.tgrelid::pg_catalog.regclass::text
FROM pg_catalog.pg_trigger tg
WHERE tg.tgrelid IN ${civic} AND NOT tg.tgisinternal
UNION
SELECT 'policy ' || p.polname || ' on ' || p.polrelid::pg_catalog.regclass::text
FROM pg_catalog.pg_policy p
WHERE p.polrelid IN ${civic}
UNION
SELECT 'publication ' || pb.pubname || ' includes ' || pr.prrelid::pg_catalog.regclass::text
FROM pg_catalog.pg_publication_rel pr
JOIN pg_catalog.pg_publication pb ON pb.oid = pr.prpubid
WHERE pr.prrelid IN ${civic}
UNION
SELECT 'publication ' || pubname || ' covers all tables'
FROM pg_catalog.pg_publication WHERE puballtables
UNION
SELECT 'foreign key ' || co.conname || ' from ' || co.conrelid::pg_catalog.regclass::text
FROM pg_catalog.pg_constraint co
JOIN pg_catalog.pg_class c ON c.oid = co.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE co.contype = 'f' AND co.confrelid IN ${civic}
  AND n.nspname NOT IN ('public', ${literal(STAGING_SCHEMA)})
UNION
SELECT 'sequence ' || s.oid::pg_catalog.regclass::text || ' owned by ' || d.refobjid::pg_catalog.regclass::text
FROM pg_catalog.pg_depend d
JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
WHERE d.refobjid IN ${civic}
ORDER BY 1;`;
}

export async function dependencyProblems(
  pg: PgRunner,
  db: string,
): Promise<string[]> {
  return (await pg.psql(db, dependencySql())).map(([line]) => line);
}

/** Whether `schema` exists in `db`. */
export async function schemaExists(
  pg: PgRunner,
  db: string,
  schema: string,
): Promise<boolean> {
  const rows = await pg.psql(
    db,
    `SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${literal(schema)}`,
  );
  return rows.length > 0;
}

/**
 * Drop a previous staging: the civic tables in it, then the schema.
 *
 * Never `CASCADE`. The tables go together, so the foreign keys between
 * them go too; anything else — a live table pointing into staging, or an
 * object in the schema this tool did not put there — makes it fail, which
 * is the point.
 */
export function dropStagingSql(): string {
  const s = ident(STAGING_SCHEMA);
  const tables = CIVIC_TABLES.map((t) => `${s}.${ident(t)}`).join(', ');
  return `BEGIN;
DROP TABLE IF EXISTS ${tables} RESTRICT;
DROP SCHEMA ${s} RESTRICT;
COMMIT;`;
}

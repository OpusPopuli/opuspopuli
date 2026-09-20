# Plan of record — #1301: `full_text_hash` encoding

| | |
|---|---|
| **Issue** | [opuspopuli#1301](https://github.com/OpusPopuli/opuspopuli/issues/1301) |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `fix/full-text-hash-encoding-1301` |
| **Severity** | Deploy-blocking. The next production release that runs migrations fails on this one. |
| **Data classification** | Public civic records (`propositions.full_text`). No personal data; the change alters how a digest is computed, never what is stored or emitted. |
| **Found while** | Applying pending migrations to a dev database with real rows, as the first step of #1294 |

## 1. What is wrong

`20260917200000_analysis_source_text_hash` (merged with #1279) generates:

```sql
GENERATED ALWAYS AS (encode(sha256("full_text"::bytea), 'hex')) STORED
```

`text::bytea` does not re-encode text into bytes — it **parses** the text as a
bytea input literal, interpreting backslash escapes. For backslash-free
ASCII/UTF-8 it coincidentally produces the right bytes.

Two distinct failures:

**It hard-errors.** SQLSTATE 22P02, `invalid input syntax for type bytea`.
**15 of 69 propositions contain a backslash**, in dev and production alike.

**It silently digests the wrong bytes** where the backslash forms a valid
escape:

```
'a\101c'::bytea             -> aAc       (escape interpreted)
convert_to('a\101c','UTF8') -> a\101c    (the actual characters)

node sha256('a\101c','utf8') = d120ae50…
pg   sha256('a\101c'::bytea) = 3f1f60b1…
```

The migration's own comment identifies that divergence as the thing that must
not happen: every row would read stale forever and regenerate on every run.
The verification behind that comment was genuine; backslash was not among the
cases tried.

## 2. Why every gate missed it

`full_text_hash` is `GENERATED ALWAYS`, and **a generation expression is never
evaluated against an empty table.** CI and `postgres_test` create the schema
empty, so the migration applied cleanly and every test passed while the
expression was wrong. Nothing in the suite inserted a proposition.

This is the general lesson, and it is the durable part of the fix: migration
tests that only assert "the migration applies" cannot see any defect in a
generated column, a check constraint, or a partial index predicate.

## 3. The fix

`convert_to(full_text,'UTF8')` is the correct encoding but is catalogued
STABLE, which Postgres rejects in a generation expression — the reason the cast
was reached for. Pin the encoding in an `IMMUTABLE` wrapper:

```sql
CREATE OR REPLACE FUNCTION op_sha256_utf8_hex(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') $$;
```

Genuinely immutable for a given input, because the destination encoding is a
literal rather than inherited from the server setting. `STRICT` keeps NULL text
producing NULL rather than the digest of the empty string, so "never had text"
stays distinguishable from "had empty text".

## 4. Amending a merged migration, and why it is safe here

The broken migration runs **first**, so a corrective follow-up is never
reached — it has to be amended in place. That is normally forbidden. It is
defensible only because it had never been applied to a durable database, which
was verified rather than assumed:

| Database | State |
|---|---|
| Production | **Not applied.** Last applied is `20260913120000_capture_detection_telemetry`; neither new column exists |
| Dev | Failed and rolled back; row counts identical before and after |
| `postgres_test`, CI | Applied against an **empty** table; both are recreated from migrations |

**Consequence for other developers:** a local `postgres_test` that recorded the
old checksum must be dropped once. `bootstrapTestDatabase` recreates it.

## 5. Verification

- The wrapper accepted in a generated column on PostgreSQL 17.6.
- Byte-identical to Node's `createHash('sha256').update(text,'utf8')` across
  ASCII, smart quotes, em dashes, Spanish accents, the empty string, a bare
  backslash and a valid escape sequence.
- **All 54 dev propositions carrying `full_text` — 15 of them containing a
  backslash — hash identically to Node. 54 of 54.**
- `postgres_test` dropped and rebuilt from the migration chain: applies clean.
- `pg_dump` emits the function (line 1123) before the table (3189) and renders
  the expression schema-qualified as `public.op_sha256_utf8_hex(full_text)`, so
  restore ordering is safe and independent of `search_path`. Verified by
  restoring the schema into a scratch database, inserting backslash-bearing
  text and confirming the stored hash still matches Node.
- `NULL` behaviour identical to the original: `sha256` is already STRICT, so
  both expressions yield NULL for NULL text. `STRICT` on the wrapper preserves
  that rather than changing it.
- Dev migrated forward through all 8 pending migrations; row counts unchanged.

## 6. The regression test

`proposition-full-text-hash.integration.spec.ts` inserts adversarial text and
compares the stored column against Node, because insertion is the only thing
that evaluates a generated column. **Verified by reintroducing the original
expression: 4 of 9 fail**, covering both the hard error and the silent
wrong-hash case.

## 7. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Next production deploy fails mid-chain, blocking all later migrations | **critical** × certain if unfixed | This fix; prod verified not to have applied it yet |
| A proposition whose text contains a backslash can never be written | **high** × likely | Same fix; 15 of 69 already contain one |
| Amending a merged migration breaks a developer's local checksum | medium × possible | Documented in §4 and in the PR; `postgres_test` is recreated by the bootstrap |
| Someone later drops or redefines `op_sha256_utf8_hex` | medium × rare | The generated column binds by OID; noted in the migration and in `down.sql`, which drops the function only after the column |
| The same class of defect exists in another generated column | medium × possible | Only one `::bytea` in the migration tree (checked); the new test establishes the pattern for exercising generated columns with rows |
| Digest is encoding-dependent | low × rare | **Resolved, not inherited.** `convert_to` converts *from* the database encoding *to* the named one, so the output is UTF-8 bytes of the characters whatever the server encoding is — matching Node for any encoding. The original comment's caveat, that restoring into a non-UTF8 database would change every hash, no longer applies |

## 8. Effort

~half a session. The fix is three lines; the verification is the work.

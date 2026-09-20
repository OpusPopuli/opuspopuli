-- Bind a proposition's analysis to the text version it was generated against
-- (opuspopuli#1279, sub-issue of the M1 provenance foundation #1207).
--
-- ── The problem ──────────────────────────────────────────────────────────
--
-- propositions-sync upserts `full_text` IN PLACE without touching the analysis
-- columns. Staleness was caught only by a TIMESTAMP comparison, never by a
-- hash of the analysed text.
--
-- #1212 made that sharper rather than softer. Claim citations no longer carry
-- offsets the model asserted; code DERIVES them by locating a verbatim quote
-- in `full_text`. They are therefore exact at the moment of generation — and
-- if `full_text` is later replaced, those same offsets silently address
-- different characters. Deriving offsets correctly and then not binding them
-- to a text version is a half-built guarantee.
--
-- ── Why one column is generated and one is not ───────────────────────────
--
-- `analysis_source_text_hash` records which text the analysis was generated
-- against. It is written by the application, once, at generation time — the
-- direct sibling of `embedding_source_hash` a few columns above, whose comment
-- states the same rationale: sync runs often and full_text rarely changes.
--
-- `full_text_hash` is GENERATED ALWAYS ... STORED, so the database maintains
-- it. The alternative — hashing in application code at every full_text write
-- site — fails the moment someone adds a write site and forgets, and the
-- failure mode is the worst kind: a row that reports FRESH while being STALE.
-- A generated column cannot drift. `search_vector` on this same table is
-- already generated for the same reason.
--
-- Staleness is then a comparison of two 64-character hashes, which keeps the
-- candidate query cheap and bounded. That is what #1212 S5 could not do: it
-- deliberately skipped this axis because Prisma cannot express a
-- column-to-column comparison and doing it in memory meant fetching every
-- candidate's full_text to apply a cap.
--
-- ── Why an IMMUTABLE wrapper and not a ::bytea cast (#1301) ──────────────
--
-- This migration first shipped using `full_text::bytea`, and that was wrong in
-- two ways. `text::bytea` does not re-encode text into bytes — it PARSES the
-- text as a bytea input literal, interpreting backslash escapes. For
-- backslash-free ASCII/UTF-8 it coincidentally yields the right bytes, which
-- is why it passed review and passed CI: CI and `postgres_test` create the
-- table EMPTY, so the generation expression is never evaluated against a row.
--
-- Against real data it fails outright — 15 of 69 propositions contain a
-- backslash, in dev and production alike:
--     ERROR: invalid input syntax for type bytea   (SQLSTATE 22P02)
--
-- And where the backslash does form a valid escape it does not fail; it
-- silently digests different bytes than the text:
--     'a\101c'::bytea            -> aAc      (the escape was interpreted)
--     convert_to('a\101c','UTF8') -> a\101c   (the actual characters)
--
-- `convert_to` is the correct encoding, but is catalogued STABLE — Postgres
-- rejects it in a generation expression, which is what the cast was reached
-- for. The answer is to pin the encoding in an IMMUTABLE wrapper. It is
-- genuinely immutable for a given input because the destination encoding is a
-- literal rather than inherited from the server setting.
--
-- Verified byte-identical against Node's
-- createHash('sha256').update(text,'utf8') across ASCII, smart quotes and
-- em-dashes, Spanish accents, the empty string, a literal backslash, AND a
-- valid escape sequence — then across all 54 propositions carrying full_text
-- in the dev corpus, 15 of which contain a backslash: 54 of 54 identical.
-- That equivalence is load-bearing: if the application and the database
-- disagreed, every row would look stale forever and regenerate on every run.
-- The first round of verification was real but never tried a backslash.
--
-- Amended in place rather than corrected by a follow-up migration because
-- this one runs first — a later migration is never reached. Defensible only
-- because it had never been applied to a durable database: production had not
-- run it (verified: neither column existed), dev failed and rolled back, and
-- only ephemeral CI and `postgres_test` had it, where the table is empty.
--
-- Additive only, per #1168 and the M1 acceptance criteria: no drops, no
-- renames. NULL on existing rows means "unknown", which the service treats as
-- stale — they regenerate once, which is wanted.

ALTER TABLE "propositions"
  ADD COLUMN IF NOT EXISTS "analysis_source_text_hash" VARCHAR(64);

-- The generated column binds to this function by OID, so dropping or
-- redefining it with a different result would silently change every stored
-- hash. Replace it only alongside a rebuild of the column.
CREATE OR REPLACE FUNCTION op_sha256_utf8_hex(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') $$;

ALTER TABLE "propositions"
  ADD COLUMN IF NOT EXISTS "full_text_hash" TEXT
  GENERATED ALWAYS AS (op_sha256_utf8_hex("full_text")) STORED;

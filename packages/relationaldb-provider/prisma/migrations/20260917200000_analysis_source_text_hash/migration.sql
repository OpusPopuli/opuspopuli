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
-- ── Why sha256(full_text::bytea) and not convert_to ──────────────────────
--
-- Verified on PostgreSQL 17.6 before writing this migration:
--   convert_to(...)  provolatile = 's' (STABLE)  -> Postgres REJECTS the
--                    generated column: "generation expression is not immutable"
--   sha256(...)      provolatile = 'i' (IMMUTABLE)
--   full_text::bytea immutable, and produces the correct digest
--
-- The cast reinterprets the text in the SERVER ENCODING, so the digest is
-- encoding-dependent: restoring into a non-UTF8 database would change every
-- hash and mark every analysis stale. The database is UTF8; this is recorded
-- rather than guarded.
--
-- Verified byte-identical against Node's
-- createHash('sha256').update(text,'utf8') across ASCII, smart quotes and
-- em-dashes, Spanish accents, and the empty string. That equivalence is
-- load-bearing: if the application and the database disagreed, every row would
-- look stale forever and regenerate on every run.
--
-- Additive only, per #1168 and the M1 acceptance criteria: no drops, no
-- renames. NULL on existing rows means "unknown", which the service treats as
-- stale — they regenerate once, which is wanted.

ALTER TABLE "propositions"
  ADD COLUMN IF NOT EXISTS "analysis_source_text_hash" VARCHAR(64);

ALTER TABLE "propositions"
  ADD COLUMN IF NOT EXISTS "full_text_hash" TEXT
  GENERATED ALWAYS AS (encode(sha256("full_text"::bytea), 'hex')) STORED;

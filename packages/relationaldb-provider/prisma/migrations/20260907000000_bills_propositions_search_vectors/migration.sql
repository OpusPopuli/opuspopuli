-- Full-text search vectors for bills and propositions (opuspopuli#1153,
-- spec docs/plans/SPEC-bills-propositions-search.md).
--
-- The lexical leg of hybrid search. Zero tsvector columns existed anywhere
-- before this; pg_trgm has been installed since the baseline migration
-- ("trigram ILIKE indexes") without a single trigram index ever being
-- created — this migration creates the first one.
--
-- Additive only: one generated column + indexes per table. No drops, no
-- renames, no backfill script — GENERATED ALWAYS ... STORED computes the
-- vector for existing rows during the ADD COLUMN table rewrite and keeps it
-- consistent through every future sync upsert with zero service code. The
-- rewrite is a one-time cost: seconds for bills (thousands of rows), trivial
-- for propositions (~52 rows).
--
-- ── Why generated columns and not triggers or service code ──────────────
--
-- The sync pipeline writes bills through several paths (initial extraction,
-- status recheck, amendment supersession). A trigger or service-side
-- tsvector write would need to cover every path and every future one; a
-- generated column cannot be bypassed and cannot go stale.
--
-- Known cost of STORED: Postgres recomputes the column on EVERY row
-- UPDATE, not only when a referenced column changes — a status-only
-- recheck still re-runs to_tsvector over the row and loses HOT-update
-- eligibility. Accepted: sync writes are batch/off-peak, and
-- un-bypassable consistency is the point.
--
-- ── Weighting ────────────────────────────────────────────────────────────
--
-- A: identifiers + title — what users type most ("AB 1236", exact phrases).
-- B: subject / summary — curated short descriptions.
-- C: AI plain-English summary (bills) — broadens recall to lay vocabulary;
--    weight C so scraped-source text always outranks generated text.
-- D: last_action (bills), full_text (propositions) — long-tail recall only.
--
-- ── full_text cap ────────────────────────────────────────────────────────
--
-- left(full_text, 262144): tsvector has a hard 1 MB limit and position
-- values clamp at 16383 anyway; 256 kB of statute text is ample for
-- weight-D recall (Minutes.rawText applies the same 256 kB discipline).
--
-- ── 'english' config, deliberately ───────────────────────────────────────
--
-- The corpus is English legislative text. A 'spanish' column against an
-- English corpus would double index size to match nothing; Spanish-query
-- parity arrives with the semantic leg (#1156/#1157) whose embedding model
-- is multilingual. to_tsvector with an explicit regconfig is IMMUTABLE,
-- which is what makes it legal in a generated column.

ALTER TABLE "bills" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("bill_number", '') || ' ' || coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("subject", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("ai_summary"->>'plainEnglishSummary', '')), 'C') ||
    setweight(to_tsvector('english', coalesce("last_action", '')), 'D')
  ) STORED;

ALTER TABLE "propositions" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("external_id", '') || ' ' || coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce("full_text", ''), 262144)), 'D')
  ) STORED;

CREATE INDEX "bills_search_vector_idx"
  ON "bills"
  USING gin ("search_vector");

CREATE INDEX "propositions_search_vector_idx"
  ON "propositions"
  USING gin ("search_vector");

-- Identifier fuzz: measure-number-shaped typeahead queries ("AB1236",
-- "ab 1236" — a letter prefix is required; bare numbers go through FTS)
-- run ILIKE prefix matches against bill_number; the trigram index makes
-- that an index scan instead of the seq scan every other ILIKE in this
-- repo pays for, and also serves future substring matching.
CREATE INDEX "bills_bill_number_trgm_idx"
  ON "bills"
  USING gin ("bill_number" gin_trgm_ops);

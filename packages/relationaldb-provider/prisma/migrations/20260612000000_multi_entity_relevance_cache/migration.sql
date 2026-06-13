-- Multi-entity relevance cache (opuspopuli#836).
--
-- Renames `personalized_feed_cache` → `bill_relevance_cache` for symmetry
-- with three new sibling cache tables (proposition / representative /
-- legislative-committee). Each table owns its own lifecycle, TTL, indexes,
-- and can evolve independently. Polymorphic-association (one discriminated
-- table) was rejected in favor of this separation-of-concerns layout.
--
-- The rename is metadata-only at the Postgres level (no row movement, no
-- backfill). The new tables start empty. All changes are additive — safe
-- for prod per CLAUDE.md.

-- ============================================
-- 1. Rename personalized_feed_cache → bill_relevance_cache
-- ============================================
--
-- ALTER TABLE ... RENAME TO is metadata-only. The implicit PK constraint
-- is auto-renamed; explicit named indexes + FK constraints are renamed
-- below for symmetry with what Prisma would have generated if the table
-- had been called bill_relevance_cache from the start.

ALTER TABLE "personalized_feed_cache" RENAME TO "bill_relevance_cache";

ALTER INDEX "personalized_feed_cache_pkey"
  RENAME TO "bill_relevance_cache_pkey";
ALTER INDEX "personalized_feed_cache_user_id_bill_id_key"
  RENAME TO "bill_relevance_cache_user_id_bill_id_key";
ALTER INDEX "personalized_feed_cache_user_id_computed_at_idx"
  RENAME TO "bill_relevance_cache_user_id_computed_at_idx";
ALTER INDEX "personalized_feed_cache_expires_at_idx"
  RENAME TO "bill_relevance_cache_expires_at_idx";

ALTER TABLE "bill_relevance_cache"
  RENAME CONSTRAINT "personalized_feed_cache_user_id_fkey"
  TO "bill_relevance_cache_user_id_fkey";
ALTER TABLE "bill_relevance_cache"
  RENAME CONSTRAINT "personalized_feed_cache_bill_id_fkey"
  TO "bill_relevance_cache_bill_id_fkey";

-- ============================================
-- 2. Proposition relevance cache
-- ============================================
--
-- Sibling of bill_relevance_cache for ballot propositions. No
-- relevance_score column — the candidate set is "everything on the user's
-- ballot" (scoped by UserJurisdiction.state + .county), no ranker.

CREATE TABLE "proposition_relevance_cache" (
  "id"                    TEXT        NOT NULL,
  "user_id"               TEXT        NOT NULL,
  "proposition_id"        TEXT        NOT NULL,
  "relevance_explanation" TEXT,
  "template_hash"         TEXT,
  "variant_id"            VARCHAR(50),
  "tokens_in"             INTEGER,
  "tokens_out"            INTEGER,
  "computed_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"            TIMESTAMPTZ NOT NULL,

  CONSTRAINT "proposition_relevance_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposition_relevance_cache_user_id_proposition_id_key"
  ON "proposition_relevance_cache" ("user_id", "proposition_id");
CREATE INDEX "proposition_relevance_cache_user_id_computed_at_idx"
  ON "proposition_relevance_cache" ("user_id", "computed_at" DESC);
CREATE INDEX "proposition_relevance_cache_expires_at_idx"
  ON "proposition_relevance_cache" ("expires_at");

ALTER TABLE "proposition_relevance_cache"
  ADD CONSTRAINT "proposition_relevance_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "proposition_relevance_cache"
  ADD CONSTRAINT "proposition_relevance_cache_proposition_id_fkey"
  FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE CASCADE;

-- ============================================
-- 3. Representative relevance cache
-- ============================================
--
-- Sibling of bill_relevance_cache for elected reps. Candidate set is the
-- user's resolved rep slate (federal + state + county + city) — already
-- scoped, no ranker needed.

CREATE TABLE "representative_relevance_cache" (
  "id"                    TEXT        NOT NULL,
  "user_id"               TEXT        NOT NULL,
  "representative_id"     TEXT        NOT NULL,
  "relevance_explanation" TEXT,
  "template_hash"         TEXT,
  "variant_id"            VARCHAR(50),
  "tokens_in"             INTEGER,
  "tokens_out"            INTEGER,
  "computed_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"            TIMESTAMPTZ NOT NULL,

  CONSTRAINT "representative_relevance_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "representative_relevance_cache_user_id_representative_id_key"
  ON "representative_relevance_cache" ("user_id", "representative_id");
CREATE INDEX "representative_relevance_cache_user_id_computed_at_idx"
  ON "representative_relevance_cache" ("user_id", "computed_at" DESC);
CREATE INDEX "representative_relevance_cache_expires_at_idx"
  ON "representative_relevance_cache" ("expires_at");

ALTER TABLE "representative_relevance_cache"
  ADD CONSTRAINT "representative_relevance_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "representative_relevance_cache"
  ADD CONSTRAINT "representative_relevance_cache_representative_id_fkey"
  FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE CASCADE;

-- ============================================
-- 4. Committee (legislative) relevance cache
-- ============================================
--
-- Sibling of bill_relevance_cache for LegislativeCommittee (NOT the
-- campaign-finance Committee model — the prompt-service "committee"
-- semantics are legislative).
--
-- Privacy contract (enforced by the consumer, NOT by the database): the
-- nightly batch MUST intersect committee members with the user's resolved
-- rep slate BEFORE calling /prompts/committee-relevance-explanation. The
-- prompt-service cannot validate the claim; the contract is enforced at
-- the consumer in apps/backend/src/apps/knowledge/.../llm-rerank.service.ts.
-- See the model docblock in schema.prisma + the DTO docblock in
-- prompt-service#81 + opuspopuli#836's acceptance criteria.

CREATE TABLE "committee_relevance_cache" (
  "id"                       TEXT        NOT NULL,
  "user_id"                  TEXT        NOT NULL,
  "legislative_committee_id" TEXT        NOT NULL,
  "relevance_explanation"    TEXT,
  "template_hash"            TEXT,
  "variant_id"               VARCHAR(50),
  "tokens_in"                INTEGER,
  "tokens_out"               INTEGER,
  "computed_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"               TIMESTAMPTZ NOT NULL,

  CONSTRAINT "committee_relevance_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "committee_relevance_cache_user_id_legislative_committee_id_key"
  ON "committee_relevance_cache" ("user_id", "legislative_committee_id");
CREATE INDEX "committee_relevance_cache_user_id_computed_at_idx"
  ON "committee_relevance_cache" ("user_id", "computed_at" DESC);
CREATE INDEX "committee_relevance_cache_expires_at_idx"
  ON "committee_relevance_cache" ("expires_at");

ALTER TABLE "committee_relevance_cache"
  ADD CONSTRAINT "committee_relevance_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "committee_relevance_cache"
  ADD CONSTRAINT "committee_relevance_cache_legislative_committee_id_fkey"
  FOREIGN KEY ("legislative_committee_id") REFERENCES "legislative_committees"("id") ON DELETE CASCADE;

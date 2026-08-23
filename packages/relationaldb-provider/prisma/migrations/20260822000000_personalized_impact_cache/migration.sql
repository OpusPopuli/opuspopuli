-- Personalized-impact cache (opuspopuli#1052, subtask 3).
--
-- Per-user, per-profile cache for the "What this means to you" read that
-- leads the scan results. Keyed by (user_id, content_hash, document_type,
-- prompt_version, profile_hash):
-- - user_id scopes rows to their owner. Deliberately NOT shared across
--   users even for identical content+profile — a shared cache is a
--   membership-inference oracle (probe a profile against a petition you
--   hold and learn whether someone with those declared attributes scanned
--   it). FK cascade removes the rows with the account.
-- - document_type mirrors the generic analysis cache key (contentHash +
--   type): the same bytes analyzed as petition vs. contract produce
--   different analyses and different reads.
-- - profile_hash invalidates the row when the user's declared signals
--   change.
-- impact_text restates declared attributes in prose ("as a veteran…") —
-- treat rows as profile data, same handling class as signal_profiles.
--
-- Additive only — new table, no changes to existing tables. Safe for prod.

CREATE TABLE "personalized_impact_cache" (
  "id"             TEXT           NOT NULL,
  "user_id"        TEXT           NOT NULL,
  "content_hash"   VARCHAR(64)    NOT NULL,
  "document_type"  "DocumentType" NOT NULL,
  "prompt_version" TEXT           NOT NULL,
  "profile_hash"   VARCHAR(64)    NOT NULL,
  "impact_text"    TEXT           NOT NULL,
  "prompt_hash"    TEXT,
  "llm_provider"   VARCHAR(50),
  "llm_model"      VARCHAR(100),
  "tokens_used"    INTEGER,
  "computed_at"    TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"     TIMESTAMPTZ    NOT NULL,

  CONSTRAINT "personalized_impact_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personalized_impact_cache_user_content_type_prompt_profile_key"
  ON "personalized_impact_cache" ("user_id", "content_hash", "document_type", "prompt_version", "profile_hash");
CREATE INDEX "personalized_impact_cache_expires_at_idx"
  ON "personalized_impact_cache" ("expires_at");

ALTER TABLE "personalized_impact_cache"
  ADD CONSTRAINT "personalized_impact_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

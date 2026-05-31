-- Personalized feed cache for the LLM re-rank job (epic
-- OpusPopuli/opuspopuli#740, issue #745). One row per user/bill pair,
-- written by the nightly batch job in the knowledge service and read
-- by the `myPersonalizedBillFeed` resolver.
--
-- `relevance_explanation` is nullable on purpose: when the LLM call
-- fails, the validator rejects the output, or the per-user token
-- budget caps out, the row is still written with the embedding score
-- so the feed serves — just without the personalized sentence.
-- The frontend's WhyThisPanel falls back to the heuristic axis
-- explanation in that case (#744).
--
-- Telemetry columns (template_hash, variant_id, tokens_in, tokens_out)
-- are for cost monitoring + A/B analytics. expires_at drives both the
-- nightly recomputation cadence and the cache-eviction sweep.
--
-- Additive only — safe for prod per CLAUDE.md.

CREATE TABLE "personalized_feed_cache" (
  "id"                    TEXT                     NOT NULL,
  "user_id"               TEXT                     NOT NULL,
  "bill_id"               TEXT                     NOT NULL,
  "relevance_score"       DOUBLE PRECISION         NOT NULL,
  "relevance_explanation" TEXT,
  "template_hash"         TEXT,
  "variant_id"            VARCHAR(50),
  "tokens_in"             INTEGER,
  "tokens_out"            INTEGER,
  "computed_at"           TIMESTAMPTZ              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"            TIMESTAMPTZ              NOT NULL,

  CONSTRAINT "personalized_feed_cache_pkey" PRIMARY KEY ("id")
);

-- One cache row per user/bill pair — the nightly job upserts on this key.
CREATE UNIQUE INDEX "personalized_feed_cache_user_id_bill_id_key"
  ON "personalized_feed_cache" ("user_id", "bill_id");

-- The resolver's primary read path: most-recent cache rows per user.
CREATE INDEX "personalized_feed_cache_user_id_computed_at_idx"
  ON "personalized_feed_cache" ("user_id", "computed_at" DESC);

-- Eviction sweep: find expired rows in time order.
CREATE INDEX "personalized_feed_cache_expires_at_idx"
  ON "personalized_feed_cache" ("expires_at");

-- Foreign keys — cascade delete keeps the cache consistent when a user
-- closes their account or a bill is hard-deleted (rare; bills are soft-
-- deleted in practice, but the constraint makes the data-model intent
-- explicit).
ALTER TABLE "personalized_feed_cache"
  ADD CONSTRAINT "personalized_feed_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "personalized_feed_cache"
  ADD CONSTRAINT "personalized_feed_cache_bill_id_fkey"
  FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE;

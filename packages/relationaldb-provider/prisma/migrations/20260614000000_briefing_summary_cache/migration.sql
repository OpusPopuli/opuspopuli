-- Briefing summary cache (#849 Phase 2).
--
-- One row per (user, language). LLM-generated 2-3 sentence opening
-- paragraph for the user's /me/briefing page, produced by the
-- prompt-service `briefing-summary` template. Cache misses are
-- conveyed by row absence — the frontend then silently falls back
-- to the Phase 1 deterministic template so the greeting block
-- never breaks.

-- NOTE: `id` and `user_id` are TEXT, not UUID. `users.id` was created as
-- TEXT in the baseline migration; declaring `user_id` as UUID here would
-- make the FK uncreatable (Postgres rejects mixed-type FKs). The Prisma
-- model uses `String @default(uuid())` which generates UUIDs in client
-- code and stores them as TEXT — matching the rest of the schema.
CREATE TABLE "briefing_summary_cache" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "language" VARCHAR(5) NOT NULL,
  "summary_text" TEXT NOT NULL,
  "template_hash" TEXT,
  "variant_id" VARCHAR(50),
  "tokens_out" INTEGER,
  "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "briefing_summary_cache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "briefing_summary_cache_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "briefing_summary_cache_user_id_language_key"
  ON "briefing_summary_cache"("user_id", "language");

CREATE INDEX "briefing_summary_cache_user_id_computed_at_idx"
  ON "briefing_summary_cache"("user_id", "computed_at" DESC);

CREATE INDEX "briefing_summary_cache_expires_at_idx"
  ON "briefing_summary_cache"("expires_at");

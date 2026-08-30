-- Proposition embeddings for petition retrieval verification (opuspopuli#1074,
-- subtask 2).
--
-- Gives the filed corpus a retrievable vector so a scanned petition can be
-- matched to the measure it actually is, rather than by the case-insensitive
-- substring match in linking.service.ts — which writes a hardcoded
-- `confidence: 0.8` onto every link because nothing downstream ever depended on
-- the match being right.
--
-- Additive only: two nullable columns on an existing table, plus an index. No
-- drops, no renames, no backfill in SQL. Safe against production.
--
-- ── Why HNSW and not IVFFlat ─────────────────────────────────────────────
--
-- The plan of record said IVFFlat. That was wrong for this table and is
-- corrected here.
--
-- IVFFlat trains centroids from the data present when the index is built. Built
-- against an empty column — which is exactly the state this migration leaves
-- behind, since the backfill is a separate script — it produces a degenerate
-- index that must be dropped and rebuilt after the data lands. HNSW builds
-- incrementally and is correct from empty, so the ordering "migrate, then
-- backfill" needs no cleanup step that someone can forget.
--
-- At 52 rows neither index earns its keep over a sequential scan; the corpus is
-- small and will stay small (California ballot measures, not documents). The
-- index goes in now because there is no ANN index anywhere else in this repo to
-- copy later, and adding one under load is worse than adding one at zero rows.
--
-- vector_cosine_ops, because retrieval compares direction rather than
-- magnitude — a long filed measure and a short one should be comparable.
-- Changing the distance operator later means rebuilding the index.
--
-- ── embedding_source_hash ────────────────────────────────────────────────
--
-- Included here rather than in a second migration for subtask 3. Proposition
-- sync runs often and full_text rarely changes; without a hash of the embedded
-- source, every sync re-embeds all 52 rows and pays for inference to produce
-- identical vectors. The column is what lets the sync skip unchanged text.
--
-- 1536 dimensions to match documents.embedding — the same embeddings provider
-- serves both sides of the comparison, and a dimension mismatch would make the
-- two corpora incomparable.

ALTER TABLE "propositions" ADD COLUMN "embedding" vector(1536);

ALTER TABLE "propositions" ADD COLUMN "embedding_source_hash" TEXT;

CREATE INDEX "propositions_embedding_hnsw_idx"
  ON "propositions"
  USING hnsw ("embedding" vector_cosine_ops);

-- Record why a proposition analysis failed (opuspopuli#1085).
--
-- Four measures carry no analysis and never will under the current code. They
-- render empty on /region/propositions/[id] and in the briefing cards, and
-- nothing anywhere reports it: the reason was written by `logger.debug`, which
-- is off in production, and one refusal path wrote nothing at any level.
--
-- These columns make "we could not analyse this" a state the row holds rather
-- than an absence a reader has to infer. A Prometheus counter is the better
-- instrument for a rising failure *rate* and is a reasonable follow-up, but a
-- counter cannot answer "which measures, and why" three weeks later, and the
-- region service has no metrics wiring today to hang one on.
--
-- Additive only: two nullable columns on an existing table. No drops, no
-- renames, no backfill. Existing rows read NULL, which is the correct value —
-- "no recorded failure" — for every measure that has an analysis and for every
-- measure whose failure predates this migration.
--
-- Deliberately not an enum. The set of reasons is expected to move as the
-- failure is understood (#1085 subtask 5 re-runs the backfill precisely to
-- find out), and widening a Postgres enum in a hot table is a worse migration
-- than widening a text column. The application owns the vocabulary:
-- GenerationFailureReason in llm-generator.base.ts.
--
-- No index. The table is 52 rows and the query that reads this is a human
-- asking "what failed", not a hot path.
--
-- Requires a coordinated deploy: the region service writes these columns from
-- the same release. The migration is safe to apply ahead of the code — the
-- columns simply stay NULL until it ships.

ALTER TABLE "propositions" ADD COLUMN "analysis_failure_reason" TEXT;

ALTER TABLE "propositions" ADD COLUMN "analysis_failed_at" TIMESTAMPTZ;

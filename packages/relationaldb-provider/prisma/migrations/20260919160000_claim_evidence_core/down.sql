-- Rollback for #1291.
--
-- Drops the evidence graph. Safe while nothing reads it as authoritative — the
-- three JSONB claim columns remain the write-side cache and are untouched by
-- this migration, so no claim is lost. That stops being true once #1293's
-- dual-write is the only record of a generation.
DROP TABLE IF EXISTS "claim_relations";
DROP TABLE IF EXISTS "claim_evidence";
DROP TABLE IF EXISTS "evidence";
DROP TABLE IF EXISTS "claims";

DROP TYPE IF EXISTS "claim_relation_kind";
DROP TYPE IF EXISTS "evidence_state";

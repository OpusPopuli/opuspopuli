-- Temporal validity on claims (#1295).
--
-- Regeneration used to DELETE a subject's prior claims. That makes a model
-- refresh unmeasurable: run N overwrites run N-1, so there is nothing to
-- compare against and no way to tell whether a change helped. It also erased
-- the answer to "what did we assert about this measure last month", which a
-- civic platform should be able to answer about its own output.
--
-- Additive: existing rows get valid_from = now() and valid_until = NULL, which
-- reads as "current", and that is exactly what they are.
ALTER TABLE "claims"
  ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE "claims"
  ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMPTZ;

-- The predicate nearly every read carries: the CURRENT claims for a subject.
CREATE INDEX IF NOT EXISTS "claims_subject_type_subject_id_valid_until_idx"
  ON "claims" ("subject_type", "subject_id", "valid_until");

-- The gauge asks a different question from the writer: "all current claims,
-- grouped by family", with no subject_id to anchor on. The composite index
-- above leads with subject_type but cannot skip subject_id to reach
-- valid_until, so a partial index on the current rows is what actually serves
-- it — and it stays small, because most rows are current.
CREATE INDEX IF NOT EXISTS "claims_current_by_subject_type_idx"
  ON "claims" ("subject_type") WHERE "valid_until" IS NULL;

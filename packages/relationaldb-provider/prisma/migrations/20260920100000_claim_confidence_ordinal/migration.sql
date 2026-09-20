-- #1293: `claims.confidence` stores an ordinal, not a float.
--
-- All three generators report `high` / `medium` / `low`. Mapping those onto
-- 0.9 / 0.6 / 0.3 would invent precision no model expressed, in a column whose
-- purpose is to record what the generator said — never to stand in for
-- verification.
--
-- Safe as a type change rather than an additive column: the table was created
-- in #1291, #1293 is its first writer, and it is empty in every database. The
-- USING clause is a formality for that reason, and is written to be correct
-- anyway if a row appeared between review and deploy.
ALTER TABLE "claims"
  ALTER COLUMN "confidence" TYPE VARCHAR(10)
  USING CASE
    WHEN "confidence" IS NULL THEN NULL
    WHEN "confidence" >= 0.75 THEN 'high'
    WHEN "confidence" >= 0.45 THEN 'medium'
    ELSE 'low'
  END;

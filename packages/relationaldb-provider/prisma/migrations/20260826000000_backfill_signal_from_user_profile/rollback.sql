-- Rollback for 20260826000000_backfill_signal_from_user_profile (#1071).
--
-- Prisma does not run down migrations, so this is NOT applied automatically.
-- It is committed alongside the forward migration so the rollback path is
-- reviewed and tested rather than improvised during an incident.
--
-- This is the first rollback.sql in the repo — no prior convention existed.
-- Every other migration directory contains only migration.sql.
--
-- To apply:
--   psql "$DATABASE_URL" -f rollback.sql
--
-- The rollback is EXACT, not best-effort: it reverts only the rows this
-- backfill actually wrote, using the provenance table. A user who edited their
-- housing tenure or interests in Your Model after the backfill ran is still
-- reverted, because provenance records that we wrote the field — accept that,
-- or drop the corresponding provenance rows first to spare those users.

BEGIN;

-- 1. Revert housing_tenure on rows we wrote.
UPDATE "signal_profiles" sp
   SET "housing_tenure" = NULL,
       "updated_at"     = CURRENT_TIMESTAMP
  FROM "_backfill_1071_signal_writes" w
 WHERE w."user_id" = sp."user_id"
   AND w."field"   = 'housing_tenure';

-- 2. Revert interest_tags on rows we wrote. The column is NOT NULL, so the
--    empty array is the correct "unset" value, matching its default.
UPDATE "signal_profiles" sp
   SET "interest_tags" = ARRAY[]::TEXT[],
       "updated_at"    = CURRENT_TIMESTAMP
  FROM "_backfill_1071_signal_writes" w
 WHERE w."user_id" = sp."user_id"
   AND w."field"   = 'interest_tags';

-- 3. Remove signal_profiles rows that exist ONLY because of this backfill.
--    A row qualifies only if both backfilled fields are now unset AND every
--    other signal column is still at its default — otherwise the user has
--    real Your Model data (from onboarding or the page) and the row must stay.
DELETE FROM "signal_profiles" sp
 WHERE EXISTS (
         SELECT 1 FROM "_backfill_1071_signal_writes" w
          WHERE w."user_id" = sp."user_id"
       )
   AND sp."housing_tenure" IS NULL
   AND cardinality(sp."interest_tags") = 0
   AND sp."building_type" IS NULL
   AND cardinality(sp."tax_exposure") = 0
   AND cardinality(sp."housing_flags") = 0
   AND sp."employment_status" IS NULL
   AND sp."student_level" IS NULL
   AND sp."primary_transit_mode" IS NULL
   AND sp."political_self_id" IS NULL;

DROP TABLE IF EXISTS "_backfill_1071_signal_writes";

COMMIT;

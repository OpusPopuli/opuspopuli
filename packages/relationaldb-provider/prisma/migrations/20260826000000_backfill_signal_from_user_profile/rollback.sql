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
--
--    Two guards, and both are needed.
--
--    First, the row must be one this backfill CREATED — recorded explicitly as
--    '__row_created__' rather than inferred. An earlier draft inferred it by
--    checking that a handful of other columns were empty. signal_profiles has
--    36 data columns; that guard checked 9. A user who answered interest_tags
--    in Settings and separately set, say, has_pets in Your Model would have had
--    their whole row deleted — real data the backfill never touched. Any
--    column-enumerating guard also rots the moment a signal field is added.
--
--    Second, the row must still be empty. If the user has put anything into
--    Your Model since the backfill ran, the row is theirs now and must stay.
--    That emptiness test is generic — it walks the row as JSON rather than
--    naming columns, so it cannot fall out of date.
DELETE FROM "signal_profiles" sp
 WHERE EXISTS (
         SELECT 1 FROM "_backfill_1071_signal_writes" w
          WHERE w."user_id" = sp."user_id"
            AND w."field"   = '__row_created__'
       )
   AND NOT EXISTS (
         SELECT 1
           FROM jsonb_each(
                  to_jsonb(sp) - 'id' - 'user_id' - 'created_at' - 'updated_at'
                ) AS kv(key, value)
          WHERE value <> 'null'::jsonb
            AND value <> '[]'::jsonb
       );

DROP TABLE IF EXISTS "_backfill_1071_signal_writes";

COMMIT;

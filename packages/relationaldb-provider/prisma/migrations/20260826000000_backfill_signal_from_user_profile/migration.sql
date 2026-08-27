-- Backfill signal_profiles from the legacy user_profiles demographic/civic
-- columns (issue OpusPopuli/opuspopuli#1071, plan subtask 1).
--
-- Why: the eight UserProfile demographic/civic fields have exactly one
-- consumer — the profile-completion percentage. Their Your Model counterparts
-- are what actually drive relevance (housingTenure -> isRenter/isHomeowner,
-- interestTags -> proposition scoring Axis 2). A user who answered in Settings
-- got nothing. This carries those answers across before the legacy fields are
-- retired.
--
-- Your Model wins on conflict: we write ONLY where the target is null/empty.
-- Provenance is recorded so the rollback is exact rather than best-effort.
--
-- ADDITIVE ONLY. No drops, no renames, no type changes. The legacy columns are
-- removed in a separate follow-up PR, after the application has shipped and
-- been observed no longer reading them (plan subtask 6).
--
-- income_range is deliberately NOT handled here. It maps to incomeBand, which
-- lives inside the AES-256-GCM encrypted payload on sensitive_profiles and
-- cannot be reached from SQL. A separate Node script using EncryptionService
-- handles it (plan subtask 2).
--
-- Rollback: see rollback.sql alongside this file. Prisma does not run down
-- migrations, so it is documented and tested rather than auto-applied.

-- ============================================================
-- Provenance
-- ============================================================
-- Stores user_id + which field we wrote. Deliberately stores NO values: the
-- source values remain in user_profiles until the step-6 cleanup PR, so
-- duplicating them here would create a second copy of personal information
-- (CCPA/CPRA § 1798.140(v)) for no benefit.
CREATE TABLE IF NOT EXISTS "_backfill_1071_signal_writes" (
  "user_id" TEXT NOT NULL,
  "field"   TEXT NOT NULL,
  CONSTRAINT "_backfill_1071_signal_writes_pkey" PRIMARY KEY ("user_id", "field")
);

-- ============================================================
-- 1. Ensure a signal_profiles row exists
-- ============================================================
-- Only for users who actually have a mappable legacy value. "id" has no DB
-- default (Prisma generates it in application code), so generate one here.
-- NOTE ON ENUM CASE: the GraphQL layer exposes the enum KEYS (OWN, RENT — see
-- src/common/enums/profile.enum.ts) but PostgreSQL stores the VALUES, which are
-- lowercase ('own', 'rent', …). Comparing against the uppercase keys here
-- matches zero rows and the migration silently succeeds having done nothing.
-- Always compare against the lowercase labels.
-- The TEXT[] columns are NOT NULL *without* a database default: Prisma models
-- them as `String[]`, which it treats as implicitly-empty in application code
-- and emits no DEFAULT for. The CREATE TABLE in 20260526000000_signal_profile
-- declared defaults, but the live schema does not have them. So every array
-- column must be supplied explicitly here or the insert fails with 23502.
INSERT INTO "signal_profiles" (
  "id", "user_id",
  "tax_exposure", "housing_flags", "children_age_bands", "vehicle_types",
  "special_licenses", "parent_of_student", "interest_tags",
  "trusted_organizations", "accessibility_needs",
  "created_at", "updated_at"
)
SELECT gen_random_uuid()::TEXT, up."user_id",
       ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "user_profiles" up
WHERE (
        up."homeowner_status" IN ('rent', 'own')
     OR up."policy_priorities" && ARRAY['healthcare','education','environment',
          'immigration','taxes','housing','criminal_justice']::TEXT[]
      )
  AND NOT EXISTS (
        SELECT 1 FROM "signal_profiles" sp WHERE sp."user_id" = up."user_id"
      );

-- Record WHICH ROWS THIS BACKFILL CREATED, distinct from which fields it wrote.
-- The rollback needs this: without it, the only way to tell an
-- existed-anyway row from a backfill-created one is to sniff the other
-- columns, and signal_profiles has 36 of them. Any such guard silently rots
-- the moment a signal field is added, and getting it wrong deletes real Your
-- Model data the backfill never touched.
INSERT INTO "_backfill_1071_signal_writes" ("user_id", "field")
SELECT sp."user_id", '__row_created__'
FROM "signal_profiles" sp
WHERE sp."created_at" = sp."updated_at"
  AND EXISTS (
        SELECT 1 FROM "user_profiles" up
         WHERE up."user_id" = sp."user_id"
           AND (
                 up."homeowner_status" IN ('rent', 'own')
              OR up."policy_priorities" && ARRAY['healthcare','education',
                   'environment','immigration','taxes','housing',
                   'criminal_justice']::TEXT[]
               )
      )
  AND sp."housing_tenure" IS NULL
  AND cardinality(sp."interest_tags") = 0
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. housing_tenure
-- ============================================================
-- Only RENT/OWN map. LIVING_WITH_FAMILY, OTHER and PREFER_NOT_TO_SAY have no
-- target and are dropped, not coerced: someone living with family is neither
-- renter nor owner, and isRenter=false / isHomeowner=false is the correct
-- derivation for them.
WITH written AS (
  UPDATE "signal_profiles" sp
     SET "housing_tenure" = CASE up."homeowner_status"
                              WHEN 'rent' THEN 'renter'
                              WHEN 'own'  THEN 'owner'
                            END,
         "updated_at"     = CURRENT_TIMESTAMP
    FROM "user_profiles" up
   WHERE up."user_id" = sp."user_id"
     AND sp."housing_tenure" IS NULL
     AND up."homeowner_status" IN ('rent', 'own')
  RETURNING sp."user_id"
)
INSERT INTO "_backfill_1071_signal_writes" ("user_id", "field")
SELECT "user_id", 'housing_tenure' FROM written
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. interest_tags
-- ============================================================
-- 7 of the 20 policy_priorities values carry over. The other 13 have no
-- interestTags equivalent and are dropped — an accepted loss recorded in
-- #1071, and a large one: economy, gun_rights, gun_control, social_security,
-- infrastructure, national_security, civil_rights, womens_rights,
-- lgbtq_rights, veterans_affairs, labor_unions, small_business, agriculture.
--
-- interest_tags is NOT NULL DEFAULT '{}', so "unset" means cardinality 0.
WITH mapped AS (
  SELECT up."user_id",
         ARRAY(
           SELECT DISTINCT CASE p WHEN 'criminal_justice' THEN 'justice' ELSE p END
             FROM unnest(up."policy_priorities") AS p
            WHERE p IN ('healthcare','education','environment','immigration',
                        'taxes','housing','criminal_justice')
         ) AS tags
    FROM "user_profiles" up
), written AS (
  UPDATE "signal_profiles" sp
     SET "interest_tags" = m.tags,
         "updated_at"    = CURRENT_TIMESTAMP
    FROM mapped m
   WHERE m."user_id" = sp."user_id"
     AND cardinality(sp."interest_tags") = 0
     AND cardinality(m.tags) > 0
  RETURNING sp."user_id"
)
INSERT INTO "_backfill_1071_signal_writes" ("user_id", "field")
SELECT "user_id", 'interest_tags' FROM written
ON CONFLICT DO NOTHING;

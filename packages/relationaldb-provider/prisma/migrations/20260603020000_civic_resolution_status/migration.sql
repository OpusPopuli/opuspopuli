-- Civic-data resolution status for UserAddress (OpusPopuli/opuspopuli#802).
--
-- The address-creation flow runs JurisdictionResolutionService.resolveForAddress
-- after persisting a new UserAddress. Previously, if that resolution found
-- zero matching jurisdictions (because the jurisdictions table was empty
-- during bootstrap, or the Census Geocoder went down mid-flight, or any
-- other transient/structural failure), the failure was silent:
--   - DEBUG-level log → invisible in normal operation
--   - civic_data_updated_at stayed NULL (indistinguishable from "never tried")
--   - downstream resolvers (myCountySupervisors, representativesByDistricts)
--     returned [] without any signal to user or operator about WHY
--
-- This migration adds an explicit four-state enum to user_addresses so the
-- resolution outcome is unambiguous and surface-able:
--   pending  → row persisted; resolution hasn't run yet (transient)
--   resolved → succeeded, user_jurisdictions linked
--   no_match → ran, found zero matches (often: jurisdictions table empty)
--   failed   → ran, errored (external API down, db error, etc.)
--
-- Additive only — existing rows default to 'pending'. A backfill is NOT
-- needed; addresses whose `civic_data_updated_at` is non-null can be
-- considered effectively resolved (the column is set only on success in
-- the old code path), and a one-time SQL update after deploy will move
-- them out of 'pending' without re-running the resolver. See PR description.

-- 1. Define the enum.
CREATE TYPE "CivicResolutionStatus" AS ENUM ('pending', 'resolved', 'no_match', 'failed');

-- 2. Add column with default. NOT NULL with default avoids a backfill.
ALTER TABLE "user_addresses"
  ADD COLUMN "civic_resolution_status" "CivicResolutionStatus" NOT NULL DEFAULT 'pending';

-- 3. Optional error-message detail. Nullable — only populated when status='failed'.
ALTER TABLE "user_addresses"
  ADD COLUMN "civic_resolution_error" VARCHAR(500);

-- 4. One-time safety-net backfill. The new JurisdictionResolutionService is
--    the first code path that writes civic_data_updated_at (the column existed
--    pre-#802 but no code wrote to it). On a green-field deploy this UPDATE
--    therefore matches zero rows — that's expected. The clause is here as a
--    safety net for environments where civic_data_updated_at was populated
--    out-of-band (data migration, manual SQL, etc.) so those rows don't end
--    up showing a "pending" badge in the UI. Rows with NULL
--    civic_data_updated_at stay 'pending' and resolve naturally on the next
--    address update or via a manual resolver pass.
UPDATE "user_addresses"
  SET "civic_resolution_status" = 'resolved'
  WHERE "civic_data_updated_at" IS NOT NULL;

-- First-run onboarding completion (#758).
--
-- Additive column on `user_profiles` so existing rows keep working —
-- NULL means the user has never completed (or skipped) onboarding. The
-- final onboarding step writes `now()` on submit. This is the server-
-- side source of truth so a returning user on a new device/browser is
-- not re-prompted; the frontend treats localStorage only as a cache.

ALTER TABLE "user_profiles"
  ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ;

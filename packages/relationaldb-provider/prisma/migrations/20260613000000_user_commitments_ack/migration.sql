-- Public ethical commitments acknowledgement (#754).
--
-- Additive columns on `users` so existing rows keep working — NULL
-- means the user has never acknowledged. The onboarding step writes
-- `now()` + the current COMMITMENTS_VERSION on submit; a future
-- version bump re-prompts users whose `commitments_version_acknowledged`
-- is older than the latest published version.

ALTER TABLE "users"
  ADD COLUMN "commitments_acknowledged_at" TIMESTAMPTZ,
  ADD COLUMN "commitments_version_acknowledged" VARCHAR(20);

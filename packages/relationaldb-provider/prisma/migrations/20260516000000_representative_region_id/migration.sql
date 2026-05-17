-- Representative regionId (#22)
-- Scopes each representative to a region plugin so state reps (california),
-- county supervisors (california-sonoma), and federal reps can coexist.

ALTER TABLE "representatives"
  ADD COLUMN "region_id" VARCHAR(100) NOT NULL DEFAULT 'california';

CREATE INDEX "representatives_region_id_idx"
  ON "representatives" ("region_id");

-- Backfill: existing state reps are already California Assembly/Senate.
-- Federal reps (issue #591) will set their own regionId on insert.
-- No data loss — default covers all pre-existing rows.

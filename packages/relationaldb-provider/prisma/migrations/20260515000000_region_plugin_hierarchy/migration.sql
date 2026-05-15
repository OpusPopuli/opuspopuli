-- Region plugin hierarchy (#20 opuspopuli-regions)
-- Adds parentRegionId and fipsCode to region_plugins so county sub-regions
-- can be linked to their parent state and joined to the PostGIS jurisdictions table.

ALTER TABLE "region_plugins"
  ADD COLUMN "parent_region_id" VARCHAR(100),
  ADD COLUMN "fips_code"        VARCHAR(10);

CREATE UNIQUE INDEX "region_plugins_fips_code_key"
  ON "region_plugins" ("fips_code");

CREATE INDEX "region_plugins_parent_region_id_idx"
  ON "region_plugins" ("parent_region_id");

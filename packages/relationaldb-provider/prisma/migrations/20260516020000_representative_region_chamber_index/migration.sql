-- Compound index for county supervisor queries — filters by (regionId, chamber) together
CREATE INDEX "representatives_region_id_chamber_idx" ON "representatives" ("region_id", "chamber");

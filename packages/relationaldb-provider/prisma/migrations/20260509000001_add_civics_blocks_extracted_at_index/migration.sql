-- getCivicsData() queries WHERE region_id = ? ORDER BY extracted_at DESC.
-- The existing region_id index covers the filter; this composite index
-- also covers the sort so Postgres can avoid a sequential sort on the
-- filtered set as civics_blocks grows.

CREATE INDEX "civics_blocks_region_id_extracted_at_idx"
    ON "civics_blocks"("region_id", "extracted_at" DESC);

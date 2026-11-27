-- Map shapes for the map-first county pages (opuspopuli#1475, epic #1474).
--
-- Two kinds of geometry, kept apart on purpose:
--   boundary          full TIGER/plan polygons: point-in-polygon, "your districts"
--   display_boundary  the shoreline-clipped cartographic version, for drawing only
-- Full TIGER polygons run three nautical miles offshore and fill the bays; a
-- county's own district plan follows the shore and measures ~9% short against
-- them. Drawing needs the second geometry. Placing a reader never uses it.
--
-- Shapes are computed by the region sync and stored ready to draw: SVG path
-- data, already projected (the region config's displayProjection) and
-- simplified with shared borders simplified once. Region config decides every
-- source and projection; nothing here names a region.
--
-- Additive: one nullable column on jurisdictions (no default, no rewrite) and
-- two new tables. Safe to apply ahead of the code, which simply doesn't read
-- them yet.

ALTER TABLE "jurisdictions"
  ADD COLUMN "display_boundary" geography(MultiPolygon, 4326);

-- One drawing: the whole region, or one county with its districts.
CREATE TABLE "shape_frames" (
  "frame_key"       TEXT         PRIMARY KEY,
  -- The county a county frame draws; NULL only for the region frame.
  "jurisdiction_id" TEXT         UNIQUE
                      REFERENCES "jurisdictions"("id")
                      ON UPDATE CASCADE ON DELETE CASCADE,
  "view_box"        INTEGER[]    NOT NULL,
  "projection_srid" INTEGER      NOT NULL,
  -- How well a county's district plan fits its outline, as shares of the
  -- county's area. NULL when the frame has no districts.
  "gap_share"       DOUBLE PRECISION,
  "overlap_share"   DOUBLE PRECISION,
  "best_effort"     BOOLEAN,
  "built_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "shape_frames_view_box_len"   CHECK (array_length("view_box", 1) = 4),
  CONSTRAINT "shape_frames_srid_positive"  CHECK ("projection_srid" > 0),
  CONSTRAINT "shape_frames_region_has_no_county"
    CHECK (("frame_key" = 'region') = ("jurisdiction_id" IS NULL)),
  CONSTRAINT "shape_frames_shares_nonnegative"
    CHECK (("gap_share" IS NULL OR "gap_share" >= 0)
       AND ("overlap_share" IS NULL OR "overlap_share" >= 0)),
  -- The fit is measured, or it isn't; never half-recorded.
  CONSTRAINT "shape_frames_fit_complete"
    CHECK (("gap_share" IS NULL) = ("overlap_share" IS NULL)
       AND ("gap_share" IS NULL) = ("best_effort" IS NULL))
);

-- One jurisdiction drawn in one frame.
CREATE TABLE "jurisdiction_shapes" (
  "frame_key"       TEXT         NOT NULL
                      REFERENCES "shape_frames"("frame_key")
                      ON UPDATE CASCADE ON DELETE CASCADE,
  "jurisdiction_id" TEXT         NOT NULL
                      REFERENCES "jurisdictions"("id")
                      ON UPDATE CASCADE ON DELETE CASCADE,
  "path"            TEXT         NOT NULL,
  -- Shown to readers beside the drawing, so a shape that can't cite its
  -- source isn't stored.
  "source_name"     TEXT         NOT NULL,
  "source_url"      TEXT         NOT NULL,
  "retrieved_at"    TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY ("frame_key", "jurisdiction_id"),
  CONSTRAINT "jurisdiction_shapes_path_nonempty" CHECK ("path" <> '')
);

-- The primary key serves "every shape in a frame". This serves the cascade
-- when a jurisdiction is deleted, which otherwise scans the table.
CREATE INDEX "jurisdiction_shapes_jurisdiction_id_idx"
  ON "jurisdiction_shapes"("jurisdiction_id");

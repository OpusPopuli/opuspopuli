-- #1306 — carry the SourceVersion id onto the rows that derive from it, and
-- store the derivation those rows' claims actually index into.
--
-- Additive only: two nullable columns on source_versions, one nullable column
-- plus an index and a foreign key on each of propositions and minutes. No
-- backfill — existing rows keep NULL, because nothing anywhere records which
-- bytes they came from and a guess would be indistinguishable from a link.

-- ---------------------------------------------------------------------------
-- The derived representation
--
-- `content` holds the artifact as fetched — a PDF, or a page of HTML. But
-- Evidence.span_start/span_end index into the TEXT extracted from it, and that
-- extraction is not reproducible at read time: HTML runs through an
-- LLM-derived CSS plan, PDFs through pdf-parse with an OCR fallback, and
-- minutes are then truncated at 256 kB. Without the derived text stored
-- beside the bytes, every citation comparison is decoded-PDF against
-- extracted-text, which cannot match and would be reported as the source
-- having changed.
-- ---------------------------------------------------------------------------

ALTER TABLE "source_versions"
    ADD COLUMN "derived_text" TEXT,
    ADD COLUMN "derived_text_hash" VARCHAR(64);

CREATE INDEX "source_versions_derived_text_hash_idx"
    ON "source_versions"("derived_text_hash");

-- ---------------------------------------------------------------------------
-- The row → fetch link
-- ---------------------------------------------------------------------------

ALTER TABLE "propositions" ADD COLUMN "source_version_id" TEXT;
ALTER TABLE "minutes"      ADD COLUMN "source_version_id" TEXT;

CREATE INDEX "propositions_source_version_id_idx"
    ON "propositions"("source_version_id");
CREATE INDEX "minutes_source_version_id_idx"
    ON "minutes"("source_version_id");

-- ON DELETE SET NULL, never CASCADE — the same rule #1276 and #1280 set. An
-- archive pruned for space must not take the civic row with it; losing the
-- pointer is recoverable, losing the proposition is not.
--
-- Validated immediately rather than NOT VALID + VALIDATE: both tables are
-- small (69 and 56 rows) and the column is NULL in every one, so the
-- verification scan is free. The 18M-row treatment #1280 needed for
-- contributions would be ceremony here.
ALTER TABLE "propositions"
    ADD CONSTRAINT "propositions_source_version_id_fkey"
    FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "minutes"
    ADD CONSTRAINT "minutes_source_version_id_fkey"
    FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

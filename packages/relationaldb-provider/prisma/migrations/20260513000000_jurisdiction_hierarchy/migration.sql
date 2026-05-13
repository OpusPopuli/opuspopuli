-- Jurisdiction hierarchy (#690)
-- Adds typed, FIPS-keyed jurisdiction entities and a junction table linking
-- users to every jurisdiction they live within, resolved via Census Geocoder
-- and PostGIS point-in-polygon against loaded boundary geometries.

-- Enums
CREATE TYPE "JurisdictionType" AS ENUM (
  'STATE',
  'CONGRESSIONAL_DISTRICT',
  'STATE_SENATE_DISTRICT',
  'STATE_ASSEMBLY_DISTRICT',
  'COUNTY',
  'CITY',
  'SCHOOL_DISTRICT_UNIFIED',
  'SCHOOL_DISTRICT_ELEMENTARY',
  'SCHOOL_DISTRICT_HIGH',
  'COMMUNITY_COLLEGE_DISTRICT',
  'WATER_DISTRICT',
  'FIRE_DISTRICT',
  'TRANSIT_DISTRICT',
  'SPECIAL_DISTRICT'
);

CREATE TYPE "JurisdictionLevel" AS ENUM (
  'FEDERAL',
  'STATE',
  'COUNTY',
  'MUNICIPAL',
  'DISTRICT'
);

-- Jurisdiction table
CREATE TABLE "jurisdictions" (
  "id"          TEXT        NOT NULL,
  "fips_code"   VARCHAR(20),
  "ocd_id"      VARCHAR(255),
  "name"        VARCHAR(255) NOT NULL,
  "type"        "JurisdictionType" NOT NULL,
  "level"       "JurisdictionLevel" NOT NULL,
  "state_code"  VARCHAR(2)  NOT NULL,
  "parent_id"   TEXT,
  "metadata"    JSONB,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jurisdictions_fips_code_key" UNIQUE ("fips_code"),
  CONSTRAINT "jurisdictions_ocd_id_key" UNIQUE ("ocd_id"),
  CONSTRAINT "jurisdictions_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "jurisdictions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- PostGIS geography column for boundary polygons (Prisma Unsupported type)
ALTER TABLE "jurisdictions"
  ADD COLUMN "boundary" geography(MultiPolygon, 4326);

-- GIST spatial indexes on jurisdictions
CREATE INDEX "jurisdictions_boundary_gist_idx"
  ON "jurisdictions" USING GIST ("boundary");

CREATE INDEX "jurisdictions_type_boundary_idx"
  ON "jurisdictions" USING GIST ("boundary")
  WHERE "boundary" IS NOT NULL;

-- Standard indexes
CREATE INDEX "jurisdictions_type_idx"      ON "jurisdictions" ("type");
CREATE INDEX "jurisdictions_level_idx"     ON "jurisdictions" ("level");
CREATE INDEX "jurisdictions_state_code_idx" ON "jurisdictions" ("state_code");
CREATE INDEX "jurisdictions_parent_id_idx" ON "jurisdictions" ("parent_id");

-- PostGIS point column on user_addresses for fast spatial lookup
ALTER TABLE "user_addresses"
  ADD COLUMN "point" geography(Point, 4326);

CREATE INDEX "user_addresses_point_gist_idx"
  ON "user_addresses" USING GIST ("point");

-- UserJurisdiction junction table
CREATE TABLE "user_jurisdictions" (
  "id"              TEXT        NOT NULL,
  "user_id"         TEXT        NOT NULL,
  "user_address_id" TEXT        NOT NULL,
  "jurisdiction_id" TEXT        NOT NULL,
  "resolved_by"     VARCHAR(50) NOT NULL,
  "resolved_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "user_jurisdictions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_jurisdictions_user_address_id_jurisdiction_id_key"
    UNIQUE ("user_address_id", "jurisdiction_id"),
  CONSTRAINT "user_jurisdictions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_jurisdictions_user_address_id_fkey"
    FOREIGN KEY ("user_address_id") REFERENCES "user_addresses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_jurisdictions_jurisdiction_id_fkey"
    FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_jurisdictions_user_id_idx"         ON "user_jurisdictions" ("user_id");
CREATE INDEX "user_jurisdictions_user_address_id_idx" ON "user_jurisdictions" ("user_address_id");

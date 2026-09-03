-- County initiative thresholds for the California landing page (opuspopuli#1106,
-- epic #1105).
--
-- Elections Code §9118: a county initiative needs signatures equal to 10% of the
-- entire vote cast in that county for ALL gubernatorial candidates at the last
-- gubernatorial general. That is the one number the landing page is built on.
--
-- ── Why this is not a `counties` table ───────────────────────────────────
--
-- The brief proposed `counties(fips, name, geom, ...)`. Checked against
-- production first: all 58 California counties already exist as `jurisdictions`
-- rows with `fips_code`, `name` and `type = 'COUNTY'`. A second table carrying
-- name and FIPS would give the platform two answers to "what is 06057 called",
-- and they would diverge the first time one was reloaded and the other was not.
--
-- So this table holds ONLY the facts that have no home today, and borrows
-- identity by foreign key. `jurisdictions.fips_code` is UNIQUE
-- (jurisdictions_fips_code_key), which is what makes it a legal FK target.
--
-- Geometry is deliberately absent here too. `jurisdictions.boundary
-- geography(MultiPolygon, 4326)` already exists — currently empty for every
-- California jurisdiction, which #1107 fixes using the existing TIGER fetcher.
-- Adding a second geometry column at a different SRID would be the same
-- divergence problem in a worse place.
--
-- ── Why provenance is NOT NULL ───────────────────────────────────────────
--
-- The page's entire rhetorical weight rests on a skeptical reader being able to
-- verify each figure against their county elections office. A row that cannot
-- cite itself cannot be rendered, so the database refuses to store one.
--
-- ── Derived values are not stored ────────────────────────────────────────
--
--   signatures_required = ceil(gubernatorial_votes * 0.10)
--   share_of_registered = signatures_required::numeric / registered_voters
--
-- Computed in the query so they cannot drift from their inputs. Note `ceil`:
-- rounding down would understate a legal requirement.
--
-- Additive: two new tables, no changes to any existing table. Safe to apply
-- ahead of the application code, which simply does not read them yet.

CREATE TABLE "county_thresholds" (
  "fips"                  VARCHAR(20)  PRIMARY KEY
                            REFERENCES "jurisdictions"("fips_code")
                            ON UPDATE CASCADE ON DELETE RESTRICT,
  -- ALL gubernatorial candidates, not the winner's total. Parsing the wrong
  -- column understates every threshold on the page and still looks plausible,
  -- which is why #1107 asserts Nevada County = 5,137 against the county's own
  -- published figure.
  "gubernatorial_votes"   INTEGER      NOT NULL,
  "gubernatorial_year"    SMALLINT     NOT NULL,
  "registered_voters"     INTEGER,
  "registration_as_of"    DATE,
  "population"            INTEGER,
  "population_source"     TEXT,
  "population_as_of"      DATE,
  "source_url"            TEXT         NOT NULL,
  "retrieved_at"          TIMESTAMPTZ  NOT NULL,
  CONSTRAINT "county_thresholds_votes_positive"
    CHECK ("gubernatorial_votes" > 0),
  CONSTRAINT "county_thresholds_registered_positive"
    CHECK ("registered_voters" IS NULL OR "registered_voters" > 0)
);

-- Materialized once from jurisdictions.boundary via ST_Touches (#1107); county
-- borders do not move. Both directions are stored, so the primary key alone
-- serves lookups in either direction and no second index is needed.
CREATE TABLE "county_adjacency" (
  "fips"      VARCHAR(20) NOT NULL
                REFERENCES "jurisdictions"("fips_code")
                ON UPDATE CASCADE ON DELETE CASCADE,
  "neighbor"  VARCHAR(20) NOT NULL
                REFERENCES "jurisdictions"("fips_code")
                ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY ("fips", "neighbor"),
  -- A county is not its own neighbour. Without this a careless ST_Touches
  -- self-join silently makes every county adjacent to itself, and "cheapest
  -- adjacent county" starts returning the county you are already looking at.
  CONSTRAINT "county_adjacency_not_self" CHECK ("fips" <> "neighbor")
);

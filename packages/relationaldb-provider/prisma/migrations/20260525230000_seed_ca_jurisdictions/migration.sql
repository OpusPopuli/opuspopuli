-- Seed CA-complete jurisdictions for the user's-jurisdiction resolution flow
-- (opuspopuli#690 / follow-up to PR #737). Without these rows the
-- `JurisdictionResolutionService.resolveCensusJurisdictions` lookup
-- returns zero matches and the "My Jurisdictions" UI shows empty for
-- every CA address.
--
-- Names are written in the EXACT format the Census Geocoder API returns
-- via /geographies/coordinates layers — they are matched
-- case-insensitively against the strings already stored on
-- `user_addresses` (county, congressional_district, state_senatorial_district,
-- state_assembly_district), so any deviation here silently breaks
-- resolution again.
--
-- FIPS codes:
--   Counties      → canonical state(2) + county(3), e.g. 06097 Sonoma
--   Assembly      → state(2) + "AD" + district(3),  e.g. 06AD002
--   Senate        → state(2) + "SD" + district(3),  e.g. 06SD002
--   Congressional → state(2) + "CD" + district(2),  e.g. 06CD02
-- The county code is kept canonical because future ETL (TIGER boundary
-- imports, joins against external Census data) expects 06xxx for
-- counties. Districts are prefixed because Census GEOIDs for SLDL/SLDU
-- collide with county FIPS in the 06001–06079 range — sharing a
-- UNIQUE column means the prefix has to come from us, not Census.
--
-- OCD IDs follow https://opencivicdata.readthedocs.io/en/latest/proposals/0002.html
--
-- This migration is additive + idempotent: `ON CONFLICT (fips_code) DO NOTHING`
-- on every row. Safe to re-run after manual edits without overwriting.
--
-- Boundaries (PostGIS geography(MultiPolygon, 4326)) are intentionally
-- left NULL. Loading TIGER/Line shapefiles is a separate concern — the
-- Census-name resolution path (`resolveCensusJurisdictions`) covers the
-- user's complaint without them; PostGIS point-in-polygon resolution
-- (`resolvePostgisJurisdictions`) is purely additive and remains a
-- follow-up ETL once the user-facing surface is unblocked.

DO $$
DECLARE
  ca_state_id TEXT;
  i INT;
BEGIN
  -- ============================================================
  -- California (state-level)
  -- ============================================================
  INSERT INTO jurisdictions (id, fips_code, ocd_id, name, type, level, state_code, parent_id)
  VALUES (
    gen_random_uuid()::text,
    '06',
    'ocd-division/country:us/state:ca',
    'California',
    'STATE',
    'STATE',
    'CA',
    NULL
  )
  ON CONFLICT (fips_code) DO NOTHING;

  -- Grab the row (whether we just inserted it or it pre-existed) so
  -- downstream rows can point parent_id at it.
  SELECT id INTO ca_state_id FROM jurisdictions WHERE fips_code = '06';

  -- ============================================================
  -- 80 California State Assembly districts ("Assembly District N")
  -- Note: Census /geographies/coordinates returns NAME without the
  -- "State" prefix for lower-chamber districts. Match verbatim.
  -- ============================================================
  FOR i IN 1..80 LOOP
    INSERT INTO jurisdictions (id, fips_code, ocd_id, name, type, level, state_code, parent_id)
    VALUES (
      gen_random_uuid()::text,
      '06AD' || LPAD(i::text, 3, '0'),                     -- "06AD002" for Assembly District 2
      'ocd-division/country:us/state:ca/sldl:' || i,       -- "sldl" = state legislative district lower
      'Assembly District ' || i,
      'STATE_ASSEMBLY_DISTRICT',
      'DISTRICT',
      'CA',
      ca_state_id
    )
    ON CONFLICT (fips_code) DO NOTHING;
  END LOOP;

  -- ============================================================
  -- 40 California State Senate districts ("State Senate District N")
  -- Census uses "State Senate District N" verbatim for upper-chamber.
  -- ============================================================
  FOR i IN 1..40 LOOP
    INSERT INTO jurisdictions (id, fips_code, ocd_id, name, type, level, state_code, parent_id)
    VALUES (
      gen_random_uuid()::text,
      '06SD' || LPAD(i::text, 3, '0'),                     -- "06SD002" for State Senate District 2
      'ocd-division/country:us/state:ca/sldu:' || i,       -- "sldu" = state legislative district upper
      'State Senate District ' || i,
      'STATE_SENATE_DISTRICT',
      'DISTRICT',
      'CA',
      ca_state_id
    )
    ON CONFLICT (fips_code) DO NOTHING;
  END LOOP;

  -- ============================================================
  -- 52 California Congressional districts ("Congressional District N")
  -- 119th Congress (2025–2027) — CA delegation = 52 seats.
  -- ============================================================
  FOR i IN 1..52 LOOP
    INSERT INTO jurisdictions (id, fips_code, ocd_id, name, type, level, state_code, parent_id)
    VALUES (
      gen_random_uuid()::text,
      '06CD' || LPAD(i::text, 2, '0'),                     -- "06CD02" for Congressional District 2
      'ocd-division/country:us/state:ca/cd:' || i,
      'Congressional District ' || i,
      'CONGRESSIONAL_DISTRICT',
      'DISTRICT',
      'CA',
      ca_state_id
    )
    ON CONFLICT (fips_code) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- 58 California counties — alphabetical, with official FIPS county codes.
-- Format: state FIPS (06) + 3-digit county FIPS. Census NAME field
-- includes the " County" suffix; match verbatim.
-- ============================================================
-- One INSERT with VALUES (...) rather than 58 separate statements,
-- so a transactional db-migrate failure rolls all-or-nothing.
INSERT INTO jurisdictions (id, fips_code, ocd_id, name, type, level, state_code, parent_id)
SELECT
  gen_random_uuid()::text,
  '06' || LPAD(county_fips::text, 3, '0'),
  'ocd-division/country:us/state:ca/county:' || LOWER(REPLACE(REPLACE(county_name, ' County', ''), ' ', '_')),
  county_name,
  'COUNTY',
  'COUNTY',
  'CA',
  (SELECT id FROM jurisdictions WHERE fips_code = '06')
FROM (VALUES
  (1,   'Alameda County'),
  (3,   'Alpine County'),
  (5,   'Amador County'),
  (7,   'Butte County'),
  (9,   'Calaveras County'),
  (11,  'Colusa County'),
  (13,  'Contra Costa County'),
  (15,  'Del Norte County'),
  (17,  'El Dorado County'),
  (19,  'Fresno County'),
  (21,  'Glenn County'),
  (23,  'Humboldt County'),
  (25,  'Imperial County'),
  (27,  'Inyo County'),
  (29,  'Kern County'),
  (31,  'Kings County'),
  (33,  'Lake County'),
  (35,  'Lassen County'),
  (37,  'Los Angeles County'),
  (39,  'Madera County'),
  (41,  'Marin County'),
  (43,  'Mariposa County'),
  (45,  'Mendocino County'),
  (47,  'Merced County'),
  (49,  'Modoc County'),
  (51,  'Mono County'),
  (53,  'Monterey County'),
  (55,  'Napa County'),
  (57,  'Nevada County'),
  (59,  'Orange County'),
  (61,  'Placer County'),
  (63,  'Plumas County'),
  (65,  'Riverside County'),
  (67,  'Sacramento County'),
  (69,  'San Benito County'),
  (71,  'San Bernardino County'),
  (73,  'San Diego County'),
  (75,  'San Francisco County'),
  (77,  'San Joaquin County'),
  (79,  'San Luis Obispo County'),
  (81,  'San Mateo County'),
  (83,  'Santa Barbara County'),
  (85,  'Santa Clara County'),
  (87,  'Santa Cruz County'),
  (89,  'Shasta County'),
  (91,  'Sierra County'),
  (93,  'Siskiyou County'),
  (95,  'Solano County'),
  (97,  'Sonoma County'),
  (99,  'Stanislaus County'),
  (101, 'Sutter County'),
  (103, 'Tehama County'),
  (105, 'Trinity County'),
  (107, 'Tulare County'),
  (109, 'Tuolumne County'),
  (111, 'Ventura County'),
  (113, 'Yolo County'),
  (115, 'Yuba County')
) AS counties(county_fips, county_name)
ON CONFLICT (fips_code) DO NOTHING;

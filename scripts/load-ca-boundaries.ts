/**
 * Load California civic boundary data into the jurisdictions table.
 *
 * Sources:
 *   - US Census TIGER/Line shapefiles (GeoJSON API) for counties, cities,
 *     school districts, and state legislative districts
 *   - CA State Geoportal (gis.data.ca.gov) for independent special districts
 *
 * Idempotent — uses upsert semantics on fipsCode / ocdId.
 * Re-run anytime to refresh boundaries from source.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx ts-node -e "require('./scripts/load-ca-boundaries')"
 *   or add to package.json: "db:load-boundaries": "ts-node scripts/load-ca-boundaries.ts"
 */

import { PrismaClient } from "@opuspopuli/relationaldb-provider";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// OCD-ID prefix for California
const CA_OCD_PREFIX = "ocd-division/country:us/state:ca";
const STATE_CODE = "CA";

// Census TIGER GeoJSON API base — returns GeoJSON FeatureCollection
// See: https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_geography.html
const TIGER_BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";

// CA FIPS state code
const CA_STATE_FIPS = "06";

interface TigerFeature {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

interface TigerResponse {
  type: "FeatureCollection";
  features: TigerFeature[];
}

interface GeoPortalFeature {
  attributes: Record<string, string | number | null>;
  geometry?: {
    rings?: unknown[][];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch a TIGER/Line layer as GeoJSON FeatureCollection.
 * Uses the public TIGERweb REST service which returns GeoJSON directly.
 */
async function fetchTigerLayer(
  serviceLayer: string,
  whereClause: string,
  outFields: string,
): Promise<TigerFeature[]> {
  const params = new URLSearchParams({
    where: whereClause,
    outFields,
    outSR: "4326",
    f: "geojson",
    geometryType: "esriGeometryPolygon",
    returnGeometry: "true",
  });
  const url = `${TIGER_BASE}/${serviceLayer}/query?${params}`;

  try {
    const data = await fetchJson<TigerResponse>(url);
    return data.features ?? [];
  } catch (err) {
    console.warn(
      `  ⚠ TIGER fetch failed for ${serviceLayer}: ${(err as Error).message}`,
    );
    return [];
  }
}

/**
 * Convert a GeoJSON geometry to PostGIS WKT-compatible input via ST_GeomFromGeoJSON.
 * We pass the geometry as a JSON string for use in a raw SQL call.
 */
function geometryJson(geometry: unknown): string {
  return JSON.stringify(geometry);
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

type JurisdictionType =
  | "STATE"
  | "CONGRESSIONAL_DISTRICT"
  | "STATE_SENATE_DISTRICT"
  | "STATE_ASSEMBLY_DISTRICT"
  | "COUNTY"
  | "CITY"
  | "SCHOOL_DISTRICT_UNIFIED"
  | "SCHOOL_DISTRICT_ELEMENTARY"
  | "SCHOOL_DISTRICT_HIGH"
  | "COMMUNITY_COLLEGE_DISTRICT"
  | "WATER_DISTRICT"
  | "FIRE_DISTRICT"
  | "TRANSIT_DISTRICT"
  | "SPECIAL_DISTRICT";

type JurisdictionLevel =
  | "FEDERAL"
  | "STATE"
  | "COUNTY"
  | "MUNICIPAL"
  | "DISTRICT";

interface JurisdictionPayload {
  fipsCode?: string;
  ocdId?: string;
  name: string;
  type: JurisdictionType;
  level: JurisdictionLevel;
  stateCode: string;
  parentId?: string;
  geometry?: unknown;
}

/**
 * Upsert a jurisdiction row using Prisma's native atomic upsert, then write
 * the PostGIS boundary geometry via raw SQL.
 *
 * Prisma's upsert requires a single unique key — fipsCode is preferred when
 * present, otherwise ocdId. Records with neither are skipped (logged as gaps).
 */
async function upsertJurisdiction(
  payload: JurisdictionPayload,
): Promise<string> {
  if (!payload.fipsCode && !payload.ocdId) {
    logGap(payload.name, payload.type, "No fipsCode or ocdId — cannot upsert");
    return "";
  }

  const sharedData = {
    name: payload.name,
    type: payload.type,
    level: payload.level,
    stateCode: payload.stateCode,
    parentId: payload.parentId ?? null,
  };

  let record: { id: string };

  if (payload.fipsCode) {
    record = await prisma.jurisdiction.upsert({
      where: { fipsCode: payload.fipsCode },
      create: {
        ...sharedData,
        fipsCode: payload.fipsCode,
        ocdId: payload.ocdId ?? null,
      },
      update: sharedData,
      select: { id: true },
    });
  } else {
    record = await prisma.jurisdiction.upsert({
      where: { ocdId: payload.ocdId! },
      create: { ...sharedData, fipsCode: null, ocdId: payload.ocdId! },
      update: sharedData,
      select: { id: true },
    });
  }

  const id = record.id;

  // Write boundary geometry via raw SQL (Prisma can't emit PostGIS functions)
  if (payload.geometry) {
    await prisma.$executeRaw`
      UPDATE jurisdictions
      SET boundary = ST_Multi(ST_GeomFromGeoJSON(${geometryJson(payload.geometry)}::text))
      WHERE id = ${id}
    `;
  }

  return id;
}

// ---------------------------------------------------------------------------
// Gap log
// ---------------------------------------------------------------------------

const gaps: { name: string; type: string; reason: string }[] = [];

function logGap(name: string, type: string, reason: string) {
  gaps.push({ name, type, reason });
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadCounties(): Promise<Map<string, string>> {
  console.log("Loading CA counties...");
  const features = await fetchTigerLayer(
    "State_County/MapServer/1",
    `STATE='${CA_STATE_FIPS}'`,
    "GEOID,NAME,COUNTY",
  );

  const countyIdMap = new Map<string, string>(); // COUNTY (3-digit) → jurisdiction id

  for (const f of features) {
    const p = f.properties;
    const fipsCode = String(p["GEOID"]);
    const name = String(p["NAME"]);
    const ocdId = `${CA_OCD_PREFIX}/county:${name.toLowerCase().replace(/\s+/g, "_")}`;

    const id = await upsertJurisdiction({
      fipsCode,
      ocdId,
      name, // TIGER NAME already includes "County" (e.g., "San Mateo County")
      type: "COUNTY",
      level: "COUNTY",
      stateCode: STATE_CODE,
      geometry: f.geometry,
    });

    countyIdMap.set(String(p["COUNTY"]), id);
  }

  console.log(`  ✓ ${features.length} counties loaded`);
  return countyIdMap;
}

async function loadCities(countyIdMap: Map<string, string>): Promise<void> {
  console.log("Loading CA incorporated places (cities)...");
  // Fetch in pages — TIGERweb caps at 1000 per request
  let offset = 0;
  let count = 0;
  while (true) {
    const params = new URLSearchParams({
      where: `STATE='${CA_STATE_FIPS}'`,
      outFields: "GEOID,NAME,PLACE,STATE",
      outSR: "4326",
      f: "geojson",
      geometryType: "esriGeometryPolygon",
      returnGeometry: "true",
      resultOffset: String(offset),
      resultRecordCount: "1000",
    });
    const url = `${TIGER_BASE}/Places_CouSub_ConCity_SubMCD/MapServer/4/query?${params}`;
    let features: TigerFeature[] = [];
    try {
      const data = await fetchJson<TigerResponse>(url);
      features = data.features ?? [];
    } catch {
      break;
    }
    if (features.length === 0) break;

    for (const f of features) {
      const p = f.properties;
      const fipsCode = String(p["GEOID"]);
      const name = String(p["NAME"]);
      const ocdId = `${CA_OCD_PREFIX}/place:${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      // Cities don't have COUNTYFP in this layer — leave parent unset for now
      await upsertJurisdiction({
        fipsCode,
        ocdId,
        name,
        type: "CITY",
        level: "MUNICIPAL",
        stateCode: STATE_CODE,
        geometry: f.geometry,
      });
      count++;
    }
    if (features.length < 1000) break;
    offset += 1000;
  }
  console.log(`  ✓ ${count} cities loaded`);
  void countyIdMap; // unused for cities in this layer
}

async function loadStateLegislativeDistricts(): Promise<void> {
  console.log("Loading CA state legislative districts...");

  // State Senate (upper) — layer 1, district field: SLDU
  const senateFeatures = await fetchTigerLayer(
    "Legislative/MapServer/1",
    `STATE='${CA_STATE_FIPS}'`,
    "GEOID,NAME,SLDU",
  );

  for (const f of senateFeatures) {
    const p = f.properties;
    const district = String(p["SLDU"]).replace(/^0+/, "");
    // Prefix to avoid GEOID collision with county FIPS codes (same format)
    const fipsCode = `sldu-${String(p["GEOID"])}`;
    const ocdId = `${CA_OCD_PREFIX}/sldu:${district}`;

    await upsertJurisdiction({
      fipsCode,
      ocdId,
      name: `California State Senate District ${district}`,
      type: "STATE_SENATE_DISTRICT",
      level: "STATE",
      stateCode: STATE_CODE,
      geometry: f.geometry,
    });
  }

  // State Assembly (lower) — layer 2, district field: SLDL
  const assemblyFeatures = await fetchTigerLayer(
    "Legislative/MapServer/2",
    `STATE='${CA_STATE_FIPS}'`,
    "GEOID,NAME,SLDL",
  );

  for (const f of assemblyFeatures) {
    const p = f.properties;
    const district = String(p["SLDL"]).replace(/^0+/, "");
    // Prefix to avoid GEOID collision with county FIPS codes (same format)
    const fipsCode = `sldl-${String(p["GEOID"])}`;
    const ocdId = `${CA_OCD_PREFIX}/sldl:${district}`;

    await upsertJurisdiction({
      fipsCode,
      ocdId,
      name: `California State Assembly District ${district}`,
      type: "STATE_ASSEMBLY_DISTRICT",
      level: "STATE",
      stateCode: STATE_CODE,
      geometry: f.geometry,
    });
  }

  console.log(
    `  ✓ ${senateFeatures.length} senate + ${assemblyFeatures.length} assembly districts loaded`,
  );
}

async function loadSchoolDistricts(): Promise<void> {
  console.log("Loading CA school districts...");

  const layers = [
    {
      layer: "School/MapServer/0",
      type: "SCHOOL_DISTRICT_UNIFIED" as JurisdictionType,
      label: "unified",
    },
    {
      layer: "School/MapServer/1",
      type: "SCHOOL_DISTRICT_HIGH" as JurisdictionType,
      label: "high school",
    },
    {
      layer: "School/MapServer/2",
      type: "SCHOOL_DISTRICT_ELEMENTARY" as JurisdictionType,
      label: "elementary",
    },
  ];

  for (const { layer, type, label } of layers) {
    const features = await fetchTigerLayer(
      layer,
      `STATE='${CA_STATE_FIPS}'`,
      "GEOID,NAME",
    );

    for (const f of features) {
      const p = f.properties;
      const geoid = String(p["GEOID"]);
      const name = String(p["NAME"]);
      const ocdId = `${CA_OCD_PREFIX}/school_district:${geoid}`;

      await upsertJurisdiction({
        fipsCode: geoid,
        ocdId,
        name,
        type,
        level: "DISTRICT",
        stateCode: STATE_CODE,
        geometry: f.geometry,
      });
    }

    console.log(`  ✓ ${features.length} ${label} school districts loaded`);
  }
}

/**
 * Paginated fetch from any ArcGIS FeatureServer layer.
 * Returns all features regardless of the service's maxRecordCount limit.
 */
async function fetchArcGISFeatureServer(
  serviceUrl: string,
  outFields: string,
): Promise<TigerFeature[]> {
  const all: TigerFeature[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields,
      outSR: "4326",
      f: "geojson",
      returnGeometry: "true",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });

    const url = `${serviceUrl}/query?${params}`;
    let features: TigerFeature[] = [];
    try {
      const data = await fetchJson<TigerResponse>(url);
      features = data.features ?? [];
    } catch (err) {
      console.warn(
        `  ⚠ FeatureServer fetch failed at offset ${offset}: ${(err as Error).message}`,
      );
      break;
    }

    all.push(...features);
    if (features.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

/**
 * Load CA fire districts from CALFIRE's authoritative FeatureServer.
 * Source: California_Local_Fire_Districts (CALFIRE ArcGIS Online)
 * 671 records — all local fire protection districts in the state.
 */
async function loadFireDistricts(): Promise<void> {
  console.log("Loading CA fire districts (CALFIRE)...");

  const FIRE_FS =
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Local_Fire_Districts/FeatureServer/0";
  const features = await fetchArcGISFeatureServer(
    FIRE_FS,
    "OBJECTID,Name,County,FDID",
  );

  let count = 0;
  for (const f of features) {
    const p = f.properties;
    const name = String(p["Name"] ?? "").trim();
    const fdid = String(p["FDID"] ?? "").trim();

    if (!name) continue;

    // FDID (Fire Department ID from OSFM) is unique per district.
    // fipsCode is VARCHAR(20) — fall back to objectId if composed key would overflow.
    const objectId = String(p["OBJECTID"] ?? "");
    const candidate = fdid ? `ca-fire-${fdid}` : `ca-fire-obj-${objectId}`;
    const fipsCode =
      candidate.length <= 20 ? candidate : `ca-fire-obj-${objectId}`;

    if (!f.geometry) {
      logGap(name, "FIRE_DISTRICT", "No geometry in CALFIRE response");
      continue;
    }

    await upsertJurisdiction({
      fipsCode,
      name,
      type: "FIRE_DISTRICT",
      level: "DISTRICT",
      stateCode: STATE_CODE,
      geometry: f.geometry,
    });
    count++;
  }

  console.log(`  ✓ ${count} fire districts loaded`);
}

/**
 * Load CA water districts from the CA Department of Water Resources FeatureServer.
 * Source: i03_WaterDistricts (gis.water.ca.gov)
 * 4,021 records — all water agencies in the state.
 */
async function loadWaterDistricts(): Promise<void> {
  console.log("Loading CA water districts (DWR)...");

  const WATER_FS =
    "https://gis.water.ca.gov/arcgis/rest/services/Boundaries/i03_WaterDistricts/FeatureServer/0";
  const features = await fetchArcGISFeatureServer(
    WATER_FS,
    "OBJECTID,AGENCYNAME,AGENCYUNIQUEID",
  );

  let count = 0;
  for (const f of features) {
    const p = f.properties;
    const name = String(p["AGENCYNAME"] ?? "").trim();
    const agencyId = String(p["AGENCYUNIQUEID"] ?? "").trim();

    if (!name) continue;

    // fipsCode is VARCHAR(20) — fall back to objectId if AGENCYUNIQUEID would overflow.
    const objectId = String(p["OBJECTID"] ?? "");
    const candidate = agencyId
      ? `ca-water-${agencyId}`
      : `ca-water-obj-${objectId}`;
    const fipsCode =
      candidate.length <= 20 ? candidate : `ca-water-obj-${objectId}`;

    if (!f.geometry) {
      logGap(name, "WATER_DISTRICT", "No geometry in DWR response");
      continue;
    }

    await upsertJurisdiction({
      fipsCode,
      name,
      type: "WATER_DISTRICT",
      level: "DISTRICT",
      stateCode: STATE_CODE,
      geometry: f.geometry,
    });
    count++;
  }

  console.log(`  ✓ ${count} water districts loaded`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== CA Boundary Loader ===\n");

  try {
    await prisma.$connect();

    const countyIdMap = await loadCounties();
    await loadCities(countyIdMap);
    await loadStateLegislativeDistricts();
    await loadSchoolDistricts();
    await loadFireDistricts();
    await loadWaterDistricts();

    if (gaps.length > 0) {
      const gapPath = path.join(__dirname, "../tmp/boundary-gaps.csv");
      fs.mkdirSync(path.dirname(gapPath), { recursive: true });
      const csv = [
        "name,type,reason",
        ...gaps.map((g) => `"${g.name}","${g.type}","${g.reason}"`),
      ].join("\n");
      fs.writeFileSync(gapPath, csv);
      console.log(
        `\n⚠ ${gaps.length} coverage gaps written to tmp/boundary-gaps.csv`,
      );
    }

    console.log("\n✅ Boundary load complete");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

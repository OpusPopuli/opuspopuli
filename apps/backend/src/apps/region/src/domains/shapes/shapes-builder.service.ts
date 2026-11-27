import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { BoundarySourcesConfig } from '@opuspopuli/region-provider';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import {
  bboxOf,
  fitBbox,
  geometryToPath,
  minAreaFor,
  simplifyTogether,
  type Fit,
} from './shape-geometry';
import { shapeQuality } from './shape-quality';

/** The frame every region-wide layer is drawn in. */
export const REGION_FRAME = 'region';
export const countyFrameKey = (countyId: string): string =>
  `county:${countyId}`;

/**
 * Jurisdiction types drawn inside a county's own frame. These are platform
 * vocabulary (the JurisdictionType enum), not region data: which counties
 * have them, and from where, is entirely config.
 */
const COUNTY_DISTRICT_TYPES = ['COUNTY_SUPERVISOR_DISTRICT'];

export interface ShapesBuildResult {
  skipped?: 'no-projection' | 'no-display-layers' | 'up-to-date';
  frames: number;
  shapes: number;
  /** Types left out because some of their jurisdictions lack display geometry. */
  incompleteTypes: string[];
}

interface ShapeSource {
  name: string;
  url: string;
}

/** A layer that can be drawn, matched to jurisdictions by type or fips prefix. */
interface SourceRef extends ShapeSource {
  jurisdictionType: string;
  fipsPrefix?: string;
}

interface ProjectedRow {
  id: string;
  type: string;
  fips_code: string | null;
  geom: string;
}

interface DistrictRow {
  county_id: string;
  id: string;
  fips_code: string | null;
  geom: string;
  gap: number;
  overlap: number;
}

interface FrameRow {
  frameKey: string;
  jurisdictionId: string | null;
  viewBox: number[];
  projectionSrid: number;
  gapShare: number | null;
  overlapShare: number | null;
  bestEffort: boolean | null;
}

interface ShapeRow {
  frameKey: string;
  jurisdictionId: string;
  path: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: Date;
}

/**
 * Builds ready-to-draw map shapes from the display geometry the boundary
 * loader stored (#1475, plan §5.2):
 *
 *  - one region frame holding every type whose layer has a display source;
 *  - one frame per county: its outline and the districts inside it, clipped
 *    to the outline, with how well they fit measured.
 *
 * PostGIS projects (the region config's `displayProjection`), repairs, clips
 * and measures. Shared borders are simplified once with TopoJSON, because
 * PostGIS's own coverage simplification needs 3.4+ and Supabase pins 3.3.7;
 * when that changes, the simplification moves to SQL and nothing else does.
 *
 * Region-agnostic by construction: every source, layer and projection comes
 * from config, and every expected count from the jurisdictions the loader
 * wrote. Never used to place a reader in a district — that's `boundary`.
 */
@Injectable()
export class ShapesBuilderService {
  private readonly logger = new Logger(ShapesBuilderService.name);

  constructor(private readonly db: DbService) {}

  async build(
    region: BoundarySourcesConfig,
    counties: BoundarySourcesConfig[],
    opts: { force?: boolean } = {},
  ): Promise<ShapesBuildResult> {
    const empty = { frames: 0, shapes: 0, incompleteTypes: [] };
    const srid = region.displayProjection;
    if (!srid) return { ...empty, skipped: 'no-projection' };

    const refs = sourceRefs([region, ...counties]);
    const drawnTypes = [...new Set(refs.layers.map((r) => r.jurisdictionType))];
    if (drawnTypes.length === 0)
      return { ...empty, skipped: 'no-display-layers' };

    if (!opts.force && (await this.db.shapeFrame.count()) > 0) {
      return { ...empty, skipped: 'up-to-date' };
    }

    const { complete, incomplete } = await this.completeTypes(drawnTypes);
    const projected = complete.length
      ? await this.projectDisplay(complete, srid)
      : [];
    if (projected.length === 0) {
      this.logger.warn(
        `ShapesBuilder: no complete layer to draw (incomplete: ${incomplete.join(', ') || 'none'}) — previous shapes kept.`,
      );
      return { ...empty, incompleteTypes: incomplete };
    }

    const retrievedAt = new Date();
    const frames: FrameRow[] = [];
    const shapes: ShapeRow[] = [];

    this.addRegionFrame(
      projected,
      refs.layers,
      srid,
      retrievedAt,
      frames,
      shapes,
    );
    const outlines = projected.filter((p) => p.type === 'COUNTY');
    if (outlines.length) {
      const districts = await this.clipDistricts(srid);
      this.addCountyFrames(
        outlines,
        districts,
        refs,
        srid,
        retrievedAt,
        frames,
        shapes,
      );
    }

    await this.replaceAll(frames, shapes);
    this.logger.log(
      `ShapesBuilder: ${frames.length} frames, ${shapes.length} shapes` +
        (incomplete.length
          ? `; left out (incomplete): ${incomplete.join(', ')}`
          : '') +
        '.',
    );
    return {
      frames: frames.length,
      shapes: shapes.length,
      incompleteTypes: incomplete,
    };
  }

  /**
   * A type is drawn only when every jurisdiction of it that has a boundary
   * also has display geometry. A half-drawn layer would read as a region
   * with holes in it.
   */
  private async completeTypes(
    types: string[],
  ): Promise<{ complete: string[]; incomplete: string[] }> {
    const rows = await this.db.$queryRaw<
      { type: string; with_boundary: number; with_display: number }[]
    >`
      SELECT type::text AS type,
             count(*) FILTER (WHERE boundary IS NOT NULL)::int AS with_boundary,
             count(*) FILTER (WHERE display_boundary IS NOT NULL)::int AS with_display
        FROM jurisdictions
       WHERE type::text = ANY(${types}::text[])
       GROUP BY type
    `;
    const complete: string[] = [];
    const incomplete: string[] = [];
    for (const type of types) {
      const row = rows.find((r) => r.type === type);
      const ok =
        !!row && row.with_display > 0 && row.with_display >= row.with_boundary;
      (ok ? complete : incomplete).push(type);
    }
    return { complete, incomplete };
  }

  /** Display geometry in the region's projection, whole metres. */
  private projectDisplay(
    types: string[],
    srid: number,
  ): Promise<ProjectedRow[]> {
    return this.db.$queryRaw<ProjectedRow[]>`
      SELECT id, type::text AS type, fips_code,
             ST_AsGeoJSON(ST_Transform(display_boundary::geometry, ${srid}::int), 0) AS geom
        FROM jurisdictions
       WHERE type::text = ANY(${types}::text[]) AND display_boundary IS NOT NULL
       ORDER BY id
    `;
  }

  /**
   * Each county's districts, clipped to its display outline, with the fit
   * measured: land no district covers, and land two districts claim, as
   * shares of the county's area. A district belongs to the county holding
   * its interior point, so nothing depends on how codes are spelled.
   */
  private clipDistricts(srid: number): Promise<DistrictRow[]> {
    return this.db.$queryRaw<DistrictRow[]>`
      WITH c AS (
        SELECT id, boundary::geometry AS full_g,
               ST_CollectionExtract(ST_MakeValid(
                 ST_Transform(display_boundary::geometry, ${srid}::int)), 3) AS g
          FROM jurisdictions
         WHERE type = 'COUNTY' AND display_boundary IS NOT NULL AND boundary IS NOT NULL
      ),
      d AS (
        SELECT c.id AS county_id, j.id, j.fips_code,
               ST_CollectionExtract(ST_MakeValid(ST_Intersection(
                 ST_CollectionExtract(ST_MakeValid(
                   ST_Transform(j.boundary::geometry, ${srid}::int)), 3),
                 c.g)), 3) AS g
          FROM jurisdictions j
          JOIN c ON ST_Covers(c.full_g, ST_PointOnSurface(j.boundary::geometry))
         WHERE j.type::text = ANY(${COUNTY_DISTRICT_TYPES}::text[]) AND j.boundary IS NOT NULL
      ),
      m AS (
        SELECT county_id, sum(ST_Area(g)) AS total, ST_Area(ST_Union(g)) AS covered
          FROM d GROUP BY county_id
      )
      SELECT d.county_id, d.id, d.fips_code, ST_AsGeoJSON(d.g, 0) AS geom,
             ((ST_Area(c.g) - m.covered) / ST_Area(c.g))::float8 AS gap,
             ((m.total - m.covered) / ST_Area(c.g))::float8 AS overlap
        FROM d
        JOIN m USING (county_id)
        JOIN c ON c.id = d.county_id
       WHERE NOT ST_IsEmpty(d.g)
       ORDER BY d.county_id, d.fips_code
    `;
  }

  private addRegionFrame(
    projected: ProjectedRow[],
    layers: SourceRef[],
    srid: number,
    retrievedAt: Date,
    frames: FrameRow[],
    shapes: ShapeRow[],
  ): void {
    const fit = fitBbox(bboxOf(projected.map(geometryOf)));
    const byType: Record<string, FeatureCollection> = {};
    for (const row of projected) {
      byType[row.type] ??= { type: 'FeatureCollection', features: [] };
      byType[row.type].features.push(toFeature(row));
    }
    const simplified = simplifyTogether(byType, minAreaFor(fit.unit));
    frames.push(frameRow(REGION_FRAME, null, fit, srid, null));
    for (const [type, features] of Object.entries(simplified)) {
      const source = layers.find((l) => l.jurisdictionType === type);
      if (!source) continue;
      shapes.push(
        ...toShapeRows(REGION_FRAME, features, fit, source, retrievedAt),
      );
    }
  }

  private addCountyFrames(
    outlines: ProjectedRow[],
    districts: DistrictRow[],
    refs: { layers: SourceRef[]; districts: SourceRef[] },
    srid: number,
    retrievedAt: Date,
    frames: FrameRow[],
    shapes: ShapeRow[],
  ): void {
    const outlineSource = refs.layers.find(
      (l) => l.jurisdictionType === 'COUNTY',
    );
    if (!outlineSource) return;
    for (const county of outlines) {
      const own = districts.filter(
        (d) => d.county_id === county.id && districtSource(d, refs.districts),
      );
      const key = countyFrameKey(county.id);
      const fit = fitBbox(bboxOf([geometryOf(county)]));
      const simplified = simplifyTogether(
        {
          outline: collection([toFeature(county)]),
          districts: collection(own.map(toFeature)),
        },
        minAreaFor(fit.unit),
      );
      const first = own[0];
      frames.push(
        frameRow(
          key,
          county.id,
          fit,
          srid,
          first ? { gap: first.gap, overlap: first.overlap } : null,
        ),
      );
      shapes.push(
        ...toShapeRows(
          key,
          simplified.outline,
          fit,
          outlineSource,
          retrievedAt,
        ),
      );
      for (const feature of simplified.districts) {
        const row = own.find((d) => d.id === feature.id);
        const source = row && districtSource(row, refs.districts);
        if (source)
          shapes.push(...toShapeRows(key, [feature], fit, source, retrievedAt));
      }
    }
  }

  /** All frames replaced at once: a failed build leaves the previous shapes. */
  private async replaceAll(
    frames: FrameRow[],
    shapes: ShapeRow[],
  ): Promise<void> {
    await this.db.$transaction([
      this.db.shapeFrame.deleteMany({}),
      this.db.shapeFrame.createMany({ data: frames }),
      this.db.jurisdictionShape.createMany({ data: shapes }),
    ]);
  }
}

/** Every drawable layer named in config, with where its lines come from. */
function sourceRefs(groups: BoundarySourcesConfig[]): {
  layers: SourceRef[];
  districts: SourceRef[];
} {
  const layers: SourceRef[] = [];
  const districts: SourceRef[] = [];
  for (const group of groups) {
    for (const layer of group.tigerLayers ?? []) {
      if (layer.display) {
        layers.push({
          jurisdictionType: layer.jurisdictionType,
          name: layer.display.layerName,
          url: layer.display.url,
        });
      }
    }
    for (const layer of group.geoportalLayers ?? []) {
      if (COUNTY_DISTRICT_TYPES.includes(layer.jurisdictionType)) {
        districts.push({
          jurisdictionType: layer.jurisdictionType,
          fipsPrefix: layer.fipsPrefix,
          name: new URL(layer.url).hostname,
          url: layer.url,
        });
      }
    }
  }
  return { layers, districts };
}

/**
 * The configured layer a district came from. A district no config layer
 * accounts for is left out: a shape is never stored without its source.
 */
function districtSource(
  row: DistrictRow,
  refs: SourceRef[],
): SourceRef | undefined {
  return refs.find(
    (r) => r.fipsPrefix && row.fips_code?.startsWith(r.fipsPrefix),
  );
}

const geometryOf = (row: { geom: string }): Geometry =>
  JSON.parse(row.geom) as Geometry;

const toFeature = (row: { id: string; geom: string }): Feature => ({
  type: 'Feature',
  id: row.id,
  properties: {},
  geometry: geometryOf(row),
});

const collection = (features: Feature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

function frameRow(
  frameKey: string,
  jurisdictionId: string | null,
  fit: Fit,
  srid: number,
  fitMeasured: { gap: number; overlap: number } | null,
): FrameRow {
  const quality = fitMeasured
    ? shapeQuality(fitMeasured.gap, fitMeasured.overlap)
    : null;
  return {
    frameKey,
    jurisdictionId,
    viewBox: [...fit.viewBox],
    projectionSrid: srid,
    gapShare: quality?.gapShare ?? null,
    overlapShare: quality?.overlapShare ?? null,
    bestEffort: quality?.bestEffort ?? null,
  };
}

function toShapeRows(
  frameKey: string,
  features: Feature[],
  fit: Fit,
  source: ShapeSource,
  retrievedAt: Date,
): ShapeRow[] {
  return features
    .map((f) => ({
      frameKey,
      jurisdictionId: String(f.id),
      path: geometryToPath(f.geometry, fit.project),
      sourceName: source.name,
      sourceUrl: source.url,
      retrievedAt,
    }))
    .filter((s) => s.path !== '');
}

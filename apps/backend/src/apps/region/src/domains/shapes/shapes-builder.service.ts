import { createHash } from 'node:crypto';
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
  skipped?:
    | 'no-projection'
    | 'no-display-layers'
    | 'up-to-date'
    /** A layer already drawn is now incomplete; the old shapes are kept. */
    | 'would-drop-built'
    /** Another service is replacing the shapes right now. */
    | 'busy';
  frames: number;
  shapes: number;
  /** Types left out because some of their jurisdictions lack display geometry. */
  incompleteTypes: string[];
  /** Set by the caller when the build threw. */
  error?: string;
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
  fingerprint: string | null;
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
    const gate = await this.gate(region, counties, opts);
    return 'result' in gate ? gate.result : this.buildFrames(gate);
  }

  /**
   * Whether to build, and from what. Rebuilds when forced, or when the
   * fingerprint of the inputs (projection, sources, which layers are
   * complete) differs from the one the current frames were built from — so
   * a layer that becomes complete later, or a source changed in config, is
   * picked up without a forced reload.
   */
  private async gate(
    region: BoundarySourcesConfig,
    counties: BoundarySourcesConfig[],
    opts: { force?: boolean },
  ): Promise<{ result: ShapesBuildResult } | BuildPlan> {
    const empty = { frames: 0, shapes: 0, incompleteTypes: [] };
    const srid = region.displayProjection;
    if (!srid) return { result: { ...empty, skipped: 'no-projection' } };

    const refs = sourceRefs([region, ...counties], this.logger);
    const drawnTypes = [...new Set(refs.layers.map((r) => r.jurisdictionType))];
    if (drawnTypes.length === 0) {
      return { result: { ...empty, skipped: 'no-display-layers' } };
    }

    const { complete, incomplete } = await this.completeTypes(drawnTypes);
    const skip = (skipped: ShapesBuildResult['skipped']) => ({
      result: { ...empty, incompleteTypes: incomplete, skipped },
    });
    const fingerprint = fingerprintOf(srid, refs, complete);
    if (!opts.force && (await this.currentFingerprint()) === fingerprint) {
      return skip('up-to-date');
    }
    const lost = await this.drawnTypesAmong(incomplete);
    if (lost.length) {
      this.logger.warn(
        `ShapesBuilder: ${lost.join(', ')} drawn before but now incomplete — ` +
          'previous shapes kept until display geometry is whole again.',
      );
      return skip('would-drop-built');
    }
    return { srid, refs, complete, incomplete, fingerprint };
  }

  private async buildFrames(plan: BuildPlan): Promise<ShapesBuildResult> {
    const { srid, refs, complete, incomplete, fingerprint } = plan;
    const empty = { frames: 0, shapes: 0, incompleteTypes: incomplete };
    const projected = complete.length
      ? await this.projectDisplay(complete, srid)
      : [];
    if (projected.length === 0) {
      this.logger.warn(
        `ShapesBuilder: no complete layer to draw (incomplete: ${incomplete.join(', ') || 'none'}) — previous shapes kept.`,
      );
      return empty;
    }

    const retrievedAt = new Date();
    const frames: FrameRow[] = [];
    const shapes: ShapeRow[] = [];
    this.addRegionFrame(
      projected,
      refs.layers,
      { srid, fingerprint },
      retrievedAt,
      frames,
      shapes,
    );
    const outlines = projected.filter((p) => p.type === 'COUNTY');
    if (outlines.length) {
      const prefixes = refs.districts
        .map((r) => r.fipsPrefix)
        .filter((p): p is string => !!p);
      const districts = prefixes.length
        ? await this.clipDistricts(srid, prefixes)
        : [];
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

    if (!(await this.replaceAll(frames, shapes))) {
      this.logger.log(
        'ShapesBuilder: another service is replacing the shapes — skipped.',
      );
      return { ...empty, skipped: 'busy' };
    }
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

  private async currentFingerprint(): Promise<string | null> {
    const frame = await this.db.shapeFrame.findUnique({
      where: { frameKey: REGION_FRAME },
      select: { fingerprint: true },
    });
    return frame?.fingerprint ?? null;
  }

  /** Which of these types the current region frame already draws. */
  private async drawnTypesAmong(types: string[]): Promise<string[]> {
    if (types.length === 0) return [];
    const rows = await this.db.$queryRaw<{ type: string }[]>`
      SELECT DISTINCT j.type::text AS type
        FROM jurisdiction_shapes s
        JOIN jurisdictions j ON j.id = s.jurisdiction_id
       WHERE s.frame_key = ${REGION_FRAME} AND j.type::text = ANY(${types}::text[])
    `;
    return rows.map((r) => r.type);
  }

  /**
   * A type is drawn only when every jurisdiction of it that has a boundary
   * also has display geometry. A half-drawn layer would read as a region
   * with holes in it.
   */
  private async completeTypes(
    types: string[],
  ): Promise<{ complete: string[]; incomplete: string[] }> {
    // Per row, not by totals: a row with display geometry but no boundary
    // must not make up for one with a boundary that was never checked. A
    // row checked and found not covered by its source (display_source set,
    // no geometry) isn't missing — it just isn't drawn.
    const rows = await this.db.$queryRaw<
      { type: string; missing: number; with_display: number }[]
    >`
      SELECT type::text AS type,
             count(*) FILTER (WHERE boundary IS NOT NULL AND display_source IS NULL)::int AS missing,
             count(*) FILTER (WHERE display_boundary IS NOT NULL)::int AS with_display
        FROM jurisdictions
       WHERE type::text = ANY(${types}::text[])
       GROUP BY type
    `;
    const complete: string[] = [];
    const incomplete: string[] = [];
    for (const type of types) {
      const row = rows.find((r) => r.type === type);
      const ok = !!row && row.with_display > 0 && row.missing === 0;
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
       WHERE type::text = ANY(${types}::text[])
         AND display_boundary IS NOT NULL
         AND NOT ST_IsEmpty(display_boundary::geometry)
       ORDER BY id
    `;
  }

  /**
   * Each county's districts, clipped to its display outline, with the fit
   * measured: land no district covers, and land two districts claim, as
   * shares of the county's area. A district belongs to the county holding
   * its interior point, so nothing depends on how codes are spelled.
   */
  private clipDistricts(
    srid: number,
    prefixes: string[],
  ): Promise<DistrictRow[]> {
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
           -- Only districts a configured layer accounts for, so one that
           -- won't be drawn can't skew the county's measured fit.
           AND EXISTS (
             SELECT 1 FROM unnest(${prefixes}::text[]) AS p(prefix)
              WHERE left(j.fips_code, length(p.prefix)) = p.prefix
           )
      ),
      m AS (
        SELECT county_id, sum(ST_Area(g)) AS total, ST_Area(ST_Union(g)) AS covered
          FROM d GROUP BY county_id
      )
      SELECT d.county_id, d.id, d.fips_code, ST_AsGeoJSON(d.g, 0) AS geom,
             ((ST_Area(c.g) - m.covered) / NULLIF(ST_Area(c.g), 0))::float8 AS gap,
             ((m.total - m.covered) / NULLIF(ST_Area(c.g), 0))::float8 AS overlap
        FROM d
        JOIN m USING (county_id)
        JOIN c ON c.id = d.county_id
       WHERE NOT ST_IsEmpty(d.g) AND ST_Area(c.g) > 0
       ORDER BY d.county_id, d.fips_code
    `;
  }

  private addRegionFrame(
    projected: ProjectedRow[],
    layers: SourceRef[],
    frame: { srid: number; fingerprint: string },
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
    frames.push(
      frameRow(REGION_FRAME, null, fit, frame.srid, null, frame.fingerprint),
    );
    const fipsById = new Map(projected.map((p) => [p.id, p.fips_code]));
    for (const [type, features] of Object.entries(simplified)) {
      for (const feature of features) {
        const source = layerSource(
          type,
          fipsById.get(String(feature.id)),
          layers,
        );
        if (source) {
          shapes.push(
            ...toShapeRows(REGION_FRAME, [feature], fit, source, retrievedAt),
          );
        }
      }
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
    if (!refs.layers.some((l) => l.jurisdictionType === 'COUNTY')) return;
    for (const county of outlines) {
      try {
        const outlineSource = layerSource(
          'COUNTY',
          county.fips_code,
          refs.layers,
        );
        if (!outlineSource) continue;
        this.addCountyFrame(
          county,
          districts,
          refs,
          outlineSource,
          srid,
          retrievedAt,
          frames,
          shapes,
        );
      } catch (err) {
        // One county with a degenerate outline mustn't cost every county
        // its frame: leave it out and say so.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `ShapesBuilder: county ${county.fips_code ?? county.id} left out (${message}).`,
        );
      }
    }
  }

  private addCountyFrame(
    county: ProjectedRow,
    districts: DistrictRow[],
    refs: { layers: SourceRef[]; districts: SourceRef[] },
    outlineSource: SourceRef,
    srid: number,
    retrievedAt: Date,
    frames: FrameRow[],
    shapes: ShapeRow[],
  ): void {
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
      ...toShapeRows(key, simplified.outline, fit, outlineSource, retrievedAt),
    );
    for (const feature of simplified.districts) {
      const row = own.find((d) => d.id === feature.id);
      const source = row && districtSource(row, refs.districts);
      if (source)
        shapes.push(...toShapeRows(key, [feature], fit, source, retrievedAt));
    }
  }

  /**
   * All frames replaced at once, so a failed build leaves the previous
   * shapes. The region service and two workers each run the boundary load
   * at boot; a transaction-scoped advisory lock lets one replace and the
   * others skip (they'd write the same thing) rather than collide on the
   * frame keys.
   */
  private replaceAll(frames: FrameRow[], shapes: ShapeRow[]): Promise<boolean> {
    return this.db.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('opuspopuli:shapes-build')) AS locked
        `;
        if (!locked) return false;
        await tx.shapeFrame.deleteMany({});
        await tx.shapeFrame.createMany({ data: frames });
        await tx.jurisdictionShape.createMany({ data: shapes });
        return true;
      },
      { timeout: 60_000 },
    );
  }
}

/** What a build is made from, once the gate has passed it. */
interface BuildPlan {
  srid: number;
  refs: { layers: SourceRef[]; districts: SourceRef[] };
  complete: string[];
  incomplete: string[];
  fingerprint: string;
}

/**
 * The source URL a reader may be shown, or null. Sources are served to
 * every visitor and rendered as links, so only HTTPS gets through: a
 * `javascript:` or malformed URL in a config row is dropped, not served.
 */
function publicSourceUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** Every drawable layer named in config, with where its lines come from. */
function sourceRefs(
  groups: BoundarySourcesConfig[],
  logger: Logger,
): { layers: SourceRef[]; districts: SourceRef[] } {
  const layers: SourceRef[] = [];
  const districts: SourceRef[] = [];
  const accept = (url: string): URL | null => {
    const parsed = publicSourceUrl(url);
    if (!parsed)
      logger.warn(
        `ShapesBuilder: source '${url}' is not an HTTPS URL — layer left out.`,
      );
    return parsed;
  };
  for (const group of groups) {
    for (const layer of group.tigerLayers ?? []) {
      if (layer.display && accept(layer.display.url)) {
        layers.push({
          jurisdictionType: layer.jurisdictionType,
          fipsPrefix: layer.fipsPrefix,
          name: layer.display.layerName,
          url: layer.display.url,
        });
      }
    }
    for (const layer of group.geoportalLayers ?? []) {
      if (!COUNTY_DISTRICT_TYPES.includes(layer.jurisdictionType)) continue;
      const parsed = accept(layer.url);
      if (parsed) {
        districts.push({
          jurisdictionType: layer.jurisdictionType,
          fipsPrefix: layer.fipsPrefix,
          name: parsed.hostname,
          url: layer.url,
        });
      }
    }
  }
  return { layers, districts };
}

/** A stable hash of everything a build depends on besides the geometry itself. */
function fingerprintOf(
  srid: number,
  refs: { layers: SourceRef[]; districts: SourceRef[] },
  complete: string[],
): string {
  const key = (r: SourceRef) =>
    `${r.jurisdictionType}|${r.fipsPrefix ?? ''}|${r.name}|${r.url}`;
  return createHash('sha256')
    .update(
      JSON.stringify({
        srid,
        layers: refs.layers.map(key).sort(),
        districts: refs.districts.map(key).sort(),
        complete: [...complete].sort(),
      }),
    )
    .digest('hex');
}

/**
 * The configured layer a shape came from: its type, and the longest
 * fipsPrefix its code starts with. Two layers of one type are told apart by
 * prefix, just as the boundary loader keys them, so each shape is credited
 * to its own source.
 */
function layerSource(
  type: string,
  fipsCode: string | null | undefined,
  layers: SourceRef[],
): SourceRef | undefined {
  return layers
    .filter(
      (l) =>
        l.jurisdictionType === type &&
        (fipsCode ?? '').startsWith(l.fipsPrefix ?? ''),
    )
    .sort(
      (a, b) => (b.fipsPrefix ?? '').length - (a.fipsPrefix ?? '').length,
    )[0];
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
  fingerprint: string | null = null,
): FrameRow {
  const quality = fitMeasured
    ? shapeQuality(fitMeasured.gap, fitMeasured.overlap)
    : null;
  return {
    frameKey,
    fingerprint,
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

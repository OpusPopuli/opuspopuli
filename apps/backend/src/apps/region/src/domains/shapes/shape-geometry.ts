/**
 * Pure geometry for the shapes step (#1475). Backend only: `topojson-*`
 * never reaches a browser, which receives finished SVG path data.
 *
 * Input geometry is already projected to California Albers (EPSG:3310) and
 * rounded to whole metres by PostGIS, so everything here is planar
 * arithmetic on metres.
 */
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import type {
  GeometryCollection,
  Objects,
  Topology,
} from 'topojson-specification';

export type Bbox = readonly [number, number, number, number];

/** [minX, minY, width, height] in drawing units. */
export type ViewBox = readonly [number, number, number, number];

export interface Fit {
  viewBox: ViewBox;
  /** Metres → viewBox units, with y flipped so north is up. */
  project: (p: Position) => [number, number];
  /** Metres per viewBox unit. */
  unit: number;
}

/**
 * Fit a bbox in metres into a viewBox `width` units wide, keeping its
 * aspect, with `pad` units of margin. Coordinates round to whole units: at
 * 1,000 wide a unit is ~1 km statewide and ~50 m across a small county,
 * finer than any screen draws them.
 */
export function fitBbox(bbox: Bbox, width = 1000, pad = 4): Fit {
  const [minX, minY, maxX, maxY] = bbox;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (!positive(spanX) || !positive(spanY)) {
    throw new Error(`Cannot fit an empty bbox: ${bbox.join(',')}`);
  }
  const scale = (width - 2 * pad) / spanX;
  const height = Math.ceil(spanY * scale + 2 * pad);
  return {
    viewBox: [0, 0, width, height],
    unit: 1 / scale,
    project: ([x, y]) => [
      Math.round((x - minX) * scale + pad),
      Math.round((maxY - y) * scale + pad),
    ],
  };
}

function eachPosition(geometry: Geometry, visit: (p: Position) => void): void {
  switch (geometry.type) {
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach(visit));
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) =>
        poly.forEach((ring) => ring.forEach(visit)),
      );
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g) => eachPosition(g, visit));
      break;
    default:
      // Points and lines carry no area; a boundary layer never holds one.
      break;
  }
}

export function bboxOf(geometries: Geometry[]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  geometries.forEach((g) =>
    eachPosition(g, ([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }),
  );
  return [minX, minY, maxX, maxY];
}

/**
 * One ring as `M x y x y … Z`. After M, further pairs are implicit line-tos,
 * which keeps the files small. Points that round onto their neighbour are
 * dropped, and a ring with fewer than three distinct points left (an islet
 * smaller than a unit) is skipped rather than drawn as a speck.
 */
export function ringToPath(
  ring: Position[],
  project: Fit['project'],
): string | null {
  const points: [number, number][] = [];
  for (const position of ring) {
    const p = project(position);
    const last = points.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
  }
  const [first] = points;
  const closing = points.length > 1 ? points.at(-1) : undefined;
  if (closing && closing[0] === first[0] && closing[1] === first[1]) {
    points.pop();
  }
  if (points.length < 3) return null;
  return `M${points.map((p) => p.join(' ')).join(' ')}Z`;
}

function polygonsOf(geometry: Geometry | null): Position[][][] {
  if (geometry?.type === 'Polygon') return [(geometry as Polygon).coordinates];
  if (geometry?.type === 'MultiPolygon') {
    return (geometry as MultiPolygon).coordinates;
  }
  return [];
}

export function geometryToPath(
  geometry: Geometry | null,
  project: Fit['project'],
): string {
  return polygonsOf(geometry)
    .flatMap((rings) => rings.map((ring) => ringToPath(ring, project)))
    .filter((d): d is string => d !== null)
    .join('');
}

/**
 * The smallest triangle area (m²) worth keeping for a drawing whose units
 * are `unit` metres: a vertex that moves the line by less than `tolerance`
 * units is invisible, so it goes.
 */
export function minAreaFor(unit: number, tolerance = 0.5): number {
  return (unit * tolerance) ** 2;
}

/**
 * Simplify several layers as one topology, so a border two areas share is a
 * single arc, simplified once. Two counties' copies of their common border
 * can then never drift apart into a hairline gap, which is what simplifying
 * each county on its own produced.
 */
export function simplifyTogether<K extends string>(
  layers: Record<K, FeatureCollection>,
  minArea: number,
): Record<K, Feature[]> {
  // The typings disagree on property shapes (`{}` against GeoJSON's
  // nullable properties); the data is the same object either way.
  const topo = topology(layers) as unknown as Topology<Objects<object>>;
  const simplified = simplify(presimplify(topo), minArea);
  const out = {} as Record<K, Feature[]>;
  (Object.keys(layers) as K[]).forEach((key) => {
    const object = simplified.objects[key] as GeometryCollection;
    const collection = feature(
      simplified,
      object,
    ) as unknown as FeatureCollection;
    out[key] = collection.features;
  });
  return out;
}

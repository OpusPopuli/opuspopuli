/**
 * Shared utilities for ArcGIS MapServer / FeatureServer fetchers used by
 * the boundary-loading pipeline. TIGER (Census) and arbitrary state
 * geoportals expose the same `/<n>/query` REST shape with GeoJSON output —
 * only the base URL and default WHERE clause differ.
 *
 * Module-scoped (no Injectable) — these are pure helpers that the two
 * fetcher classes wrap.
 *
 * See opuspopuli#804.
 */

import { Logger } from '@nestjs/common';
import {
  JurisdictionType,
  JurisdictionLevel,
} from '@opuspopuli/relationaldb-provider';

/**
 * One row ready to upsert into the `jurisdictions` table. Produced by
 * `buildBoundaryRow()` below from a single GeoJSON feature; consumed by
 * `BoundaryLoaderService.upsertBoundary`. At least one of `fipsCode` /
 * `ocdId` must be present — both serve as unique keys for idempotent
 * re-runs.
 *
 * Hosted here (not in boundary-loader.service.ts) so the row builder
 * helper below can construct + return values of this type without a
 * circular module dependency on the loader.
 */
export interface BoundaryRow {
  name: string;
  type: JurisdictionType;
  level: JurisdictionLevel;
  stateCode: string;
  fipsCode?: string;
  ocdId?: string;
  /**
   * GeoJSON Geometry object (the `.geometry` of a GeoJSON Feature). PostGIS
   * reads via ST_GeomFromGeoJSON, then wraps in ST_Multi to land in the
   * `geography(MultiPolygon, 4326)` column.
   */
  geometryGeoJSON: object;
  // NOTE: parent-linking (e.g. cities → containing county) is intentionally
  // omitted at V1. The original scripts/load-ca-boundaries.ts built that
  // tree procedurally; the generic loader treats boundary rows as flat for
  // now. Hierarchy comes back as a follow-up — tracked separately from
  // opuspopuli#804.
}

/**
 * Per-layer options used by the shared row builder. `districtField` is
 * TIGER-only (special districts on geoportals don't carry district
 * numbers); pass `undefined` from GeoportalFetcher.
 *
 * `sourceLabel` is folded into the gap-detection warn lines so an operator
 * can spot the layer that misbehaved without having to grep call sites.
 */
export interface BuildBoundaryRowOptions {
  ocdIdPrefix: string;
  jurisdictionType: string;
  level: string;
  nameField: string;
  fipsField?: string;
  fipsPrefix?: string;
  districtField?: string;
  ocdIdSegment?: string;
  nameTemplate?: string;
  sourceLabel: string;
}

/**
 * GeoJSON Feature returned by ArcGIS FeatureServer `?f=geojson` mode.
 * Only the parts we actually consume are typed — geometry is intentionally
 * opaque so it can be passed verbatim to PostGIS via ST_GeomFromGeoJSON.
 */
export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * Region-level placeholder substitution context. Per-feature placeholders
 * (`${name}`, `${district}`) are filled in by the fetcher with the row's
 * attribute values — these are the values that stay constant across one
 * region's load.
 */
export interface RegionContext {
  fipsCode: string;
  stateCode: string;
  /**
   * Permissive index signature — lets RegionContext be passed directly to
   * `substituteVerbatim` / `substituteOcdId` (which expect a string-keyed
   * dictionary) without a structural cast. Real keys remain only fipsCode
   * and stateCode; the signature is a TypeScript-only widening.
   */
  [key: string]: string;
}

/**
 * Default page size for the ArcGIS REST `?resultRecordCount=` param.
 * 1000 is the public TIGERweb cap; most geoportals match it. The fetcher
 * walks pages until a partial page comes back (fewer than `pageSize`
 * features) or the request errors.
 */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Default per-request timeout. Some TIGER layers (e.g., places for
 * populous states) return 5–10 MB GeoJSON payloads — 120s leaves room.
 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Refuse to fetch from private-network / loopback hostnames. Defense-in-
 * depth against SSRF: if a malicious or misconfigured boundarySources
 * config points at an internal-network URL, the fetcher refuses before
 * issuing the request. The schema already restricts to `^https://` (per
 * opuspopuli-regions#51), but that allows public hostnames that resolve
 * to private addresses; this guard catches the literal-hostname case.
 *
 * Covers RFC1918 + loopback + link-local + IPv6 ULA. Does NOT resolve
 * DNS — checking against the resolved IP would catch redirected SSRF
 * but introduces a TOCTOU race; we accept the gap as proportional to
 * the threat (the config is admin-writable already).
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === 'ip6-localhost') return true;
  // IPv4 literals
  if (/^127\./.test(lower)) return true; // loopback
  if (/^10\./.test(lower)) return true; // RFC1918 10.0.0.0/8
  if (/^192\.168\./.test(lower)) return true; // RFC1918 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true; // RFC1918 172.16.0.0/12
  if (/^169\.254\./.test(lower)) return true; // link-local
  if (/^0\./.test(lower)) return true; // 0.0.0.0/8
  // IPv6 literals (URL hostname strips brackets so check raw)
  if (lower === '::1' || lower.startsWith('::1%')) return true; // loopback
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower))
    return true; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  return false;
}

/**
 * Paginated fetch from an ArcGIS REST `/query` endpoint with GeoJSON
 * output. Returns the concatenated `features` array across all pages, or
 * an empty array if any page errors (non-fatal — the loader treats partial
 * data as "best effort").
 *
 * Same shape used by TIGER and by arbitrary state geoportals — the only
 * variable is the base URL.
 *
 * Refuses URLs targeting private-network hosts (see isPrivateHost). The
 * schema-level `^https://` constraint plus this runtime guard combine to
 * shrink the SSRF surface against a malicious region_plugins write.
 */
export async function fetchPaginatedGeoJSON(
  baseUrl: string,
  where: string,
  outFields: string,
  options: {
    pageSize?: number;
    timeoutMs?: number;
  } = {},
): Promise<GeoJSONFeature[]> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    // Malformed URL — let the caller log the layer context.
    return [];
  }
  if (isPrivateHost(parsed.hostname)) {
    // SSRF defense: refuse private-network targets. Caller logs the layer.
    return [];
  }

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const all: GeoJSONFeature[] = [];
  let offset = 0;
  // Pagination cap — defends against a misbehaving server that returns
  // exactly `pageSize` features forever. 50 pages × 1000 = 50k features
  // is well above any expected single-region boundary count.
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      where,
      outFields,
      outSR: '4326',
      f: 'geojson',
      geometryType: 'esriGeometryPolygon',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const url = `${baseUrl}/query?${params.toString()}`;

    let features: GeoJSONFeature[];
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // HTTP error — return what we accumulated, log nothing here (the
        // fetcher class logs with the layer context the caller cares about).
        return all;
      }
      const data = (await res.json()) as GeoJSONFeatureCollection;
      features = data.features ?? [];
    } catch {
      return all;
    }

    all.push(...features);
    if (features.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/**
 * Apply `${name}` / `${district}` / `${fipsCode}` / `${stateCode}` substitution
 * to a template, preserving each value verbatim. Used for `where` clauses,
 * `nameTemplate` rendering, and any other context where mixed-case names
 * are correct.
 *
 * Unknown placeholders pass through unchanged so a typo doesn't silently
 * collapse to an empty string — the resulting URL will fail informatively.
 */
export function substituteVerbatim(
  template: string,
  vars: { readonly [key: string]: string | undefined },
): string {
  return template.replace(/\$\{(\w+)\}/g, (full, key: string) => {
    const v = vars[key];
    return v === undefined ? full : v;
  });
}

/**
 * Apply substitution with OCD-ID normalization on `${name}`: whitespace
 * collapsed to a single underscore, lowercased. Per the schema contract
 * documented in opuspopuli-regions#51, this is the rule the schema's
 * `ocdIdSegment` description promises.
 *
 * `${district}`, `${fipsCode}`, `${stateCode}` are substituted verbatim —
 * district numbers are already normalized by the fetcher, FIPS/state are
 * conventional all-uppercase or numeric.
 */
export function substituteOcdId(
  template: string,
  vars: { readonly [key: string]: string | undefined },
): string {
  return template.replace(/\$\{(\w+)\}/g, (full, key: string) => {
    const v = vars[key];
    if (v === undefined) return full;
    if (key === 'name') return normalizeForOcdId(v);
    return v;
  });
}

/**
 * Whitespace → underscore + lowercase. The schema-promised normalization
 * for `${name}` inside OCD-ID segments. Multiple consecutive whitespace
 * characters collapse to a single underscore; leading/trailing whitespace
 * is trimmed first so 'Los Angeles  ' doesn't end up 'los_angeles__'.
 */
export function normalizeForOcdId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Validate that a config-supplied jurisdictionType matches a value in the
 * Prisma `JurisdictionType` enum. The opuspopuli-regions schema and the
 * Prisma enum are kept in sync manually — this guard catches a future drift
 * (schema PR adds LIBRARY_DISTRICT; Prisma not yet updated) at fetch time
 * with a logged warning instead of a runtime upsert crash.
 *
 * Returns the typed enum value on match, null on miss.
 */
export function validateJurisdictionType(
  value: string,
): JurisdictionType | null {
  return (Object.values(JurisdictionType) as string[]).includes(value)
    ? (value as JurisdictionType)
    : null;
}

/**
 * Validate that a config-supplied level matches a value in the Prisma
 * `JurisdictionLevel` enum. Same drift guard as validateJurisdictionType.
 */
export function validateJurisdictionLevel(
  value: string,
): JurisdictionLevel | null {
  return (Object.values(JurisdictionLevel) as string[]).includes(value)
    ? (value as JurisdictionLevel)
    : null;
}

/**
 * Default attribute key used as the fips_code source when a TigerLayerConfig
 * doesn't override. TIGER layers almost universally expose a 'GEOID'
 * column that's globally unique per feature. Re-exported so both fetchers
 * (and the row builder below) share a single constant.
 */
export const DEFAULT_FIPS_FIELD = 'GEOID';

/**
 * Map ONE GeoJSON feature to a BoundaryRow, or null when the feature is
 * unusable (missing nameField, missing geometry, jurisdictionType/level
 * doesn't match the Prisma enum).
 *
 * Extracted out of TigerFetcher / GeoportalFetcher because the two
 * featureToRow methods otherwise diverge only in (a) the source label
 * threaded into warn logs and (b) whether `districtField` is present.
 * Keeping one canonical builder also keeps OCD-ID normalization rules in
 * one place — easy to audit + change.
 */
export function buildBoundaryRow(
  feature: GeoJSONFeature,
  ctx: RegionContext,
  opts: BuildBoundaryRowOptions,
  logger: Logger,
): BoundaryRow | null {
  const props = feature.properties;
  const rawName = props[opts.nameField];
  if (rawName === undefined || rawName === null || rawName === '') {
    logger.warn(
      `${opts.sourceLabel}: feature missing nameField '${opts.nameField}' — skipping`,
    );
    return null;
  }
  if (!feature.geometry) {
    logger.warn(`${opts.sourceLabel}: feature has no geometry — skipping`);
    return null;
  }
  const jurisdictionType = validateJurisdictionType(opts.jurisdictionType);
  const level = validateJurisdictionLevel(opts.level);
  if (!jurisdictionType || !level) {
    logger.warn(
      `${opts.sourceLabel}: invalid jurisdictionType=${opts.jurisdictionType} or level=${opts.level} — skipping. Schema and Prisma enums may have drifted.`,
    );
    return null;
  }

  const nameValue = String(rawName).trim();
  // TIGER district codes are zero-padded ('001', '042'); strip leading
  // zeros so OCD-IDs and human-readable names use the natural number.
  // GeoportalLayerConfig has no districtField — special districts don't
  // use district numbers, so we fall through to ''.
  const districtValue = opts.districtField
    ? String(props[opts.districtField] ?? '').replace(/^0+/, '') || '0'
    : '';
  // Each fetcher resolves its own fipsField default before calling in
  // (TigerFetcher defaults to GEOID; GeoportalFetcher leaves undefined when
  // the source has no FIPS analog). So `undefined` here unambiguously means
  // "no FIPS lookup" and the loader takes the ocdId upsert path.
  const rawFipsValue =
    opts.fipsField !== undefined ? props[opts.fipsField] : undefined;
  const fipsCode =
    rawFipsValue !== undefined && rawFipsValue !== null && rawFipsValue !== ''
      ? `${opts.fipsPrefix ?? ''}${String(rawFipsValue)}`
      : undefined;

  const subVars: Record<string, string> = {
    name: nameValue,
    district: districtValue,
    fipsCode: ctx.fipsCode,
    stateCode: ctx.stateCode,
  };

  const ocdIdSegment = opts.ocdIdSegment
    ? substituteOcdId(opts.ocdIdSegment, subVars)
    : undefined;
  const ocdId = ocdIdSegment ? `${opts.ocdIdPrefix}${ocdIdSegment}` : undefined;

  const name = opts.nameTemplate
    ? substituteVerbatim(opts.nameTemplate, subVars)
    : nameValue;

  return {
    name,
    type: jurisdictionType,
    level,
    stateCode: ctx.stateCode,
    fipsCode,
    ocdId,
    geometryGeoJSON: feature.geometry as object,
  };
}

/**
 * Map every feature in the list and emit the "N/M features → BoundaryRow"
 * summary log. Both fetcher classes call this after fetchPaginatedGeoJSON
 * returns. Pulling the loop + log out keeps the public `fetch()` methods
 * thin and lets jscpd find no duplicate (the two fetcher classes now
 * differ only in URL construction + WHERE-default).
 */
export function mapFeaturesToRows(
  features: GeoJSONFeature[],
  ctx: RegionContext,
  opts: BuildBoundaryRowOptions,
  logger: Logger,
): BoundaryRow[] {
  const rows: BoundaryRow[] = [];
  for (const feature of features) {
    const row = buildBoundaryRow(feature, ctx, opts, logger);
    if (row) rows.push(row);
  }
  logger.log(
    `${opts.sourceLabel}: ${rows.length}/${features.length} features → BoundaryRow (type=${opts.jurisdictionType})`,
  );
  return rows;
}

import { Injectable, Logger } from '@nestjs/common';
import type {
  DisplayLayerConfig,
  TigerLayerConfig,
} from '@opuspopuli/region-provider';
import {
  DEFAULT_FIPS_FIELD,
  fetchPaginatedGeoJSON,
  fetchServiceDirectory,
  mapFeaturesToRows,
  pickLayerIdByName,
  substituteVerbatim,
  type BoundaryRow,
  type RegionContext,
} from './arcgis.utils';

/**
 * Base URL for the US Census TIGERweb ArcGIS REST services. Hardcoded
 * here (not in the region config) because every TIGER layer is hosted on
 * this single service — different layer paths just append the per-layer
 * sub-route.
 *
 * If Census ever changes hosts, this constant moves; per-region configs
 * stay stable.
 */
const TIGER_BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';

/**
 * Default WHERE clause when a TigerLayerConfig doesn't specify one.
 * Filters to the active region's state via the `STATE` attribute every
 * TIGER layer exposes. `${fipsCode}` is substituted from RegionContext.
 */
const DEFAULT_WHERE = "STATE='${fipsCode}'";

/**
 * One feature of a layer's display geometry, keyed exactly as the layer's
 * own rows are, so it lands on the same `jurisdictions` row (#1475).
 */
export interface DisplayRow {
  fipsCode: string;
  geometryGeoJSON: unknown;
}

/** A layer's display geometry and where it came from. */
export interface DisplayBatch {
  rows: DisplayRow[];
  /** The resolved layer URL, recorded as the shapes' source. */
  sourceUrl: string;
}

/**
 * Generic TIGER/Line layer fetcher. Counties, places, state legislative
 * districts, school districts — every TIGER layer the platform consumes
 * runs through this single config-driven path.
 *
 * One instance handles all TIGER layers for one region's load —
 * `fetch(layer, ctx, ocdIdPrefix)` runs the paginated query for ONE
 * layer, maps each feature to a BoundaryRow via the shared
 * `mapFeaturesToRows` helper, and returns the batch. The
 * BoundaryLoaderService aggregates across layers.
 *
 * Errors are non-fatal: a transient TIGER outage returns an empty array
 * for the affected layer. Other layers continue. See opuspopuli#804.
 */
@Injectable()
export class TigerFetcher {
  private readonly logger = new Logger(TigerFetcher.name);

  async fetch(
    layer: TigerLayerConfig,
    ctx: RegionContext,
    ocdIdPrefix: string,
  ): Promise<BoundaryRow[]> {
    const where = substituteVerbatim(layer.where ?? DEFAULT_WHERE, ctx);
    const layerPath = await this.resolveLayerPath(layer);
    if (layerPath === null) return [];
    const baseUrl = `${TIGER_BASE}/${layerPath}`;
    const sourceLabel = `TigerFetcher: ${layerPath}`;

    const features = await fetchPaginatedGeoJSON(
      baseUrl,
      where,
      layer.outFields,
    );

    if (features.length === 0) {
      this.logger.warn(
        `${sourceLabel}: 0 features (where=${where}). ` +
          'Either a transient TIGER outage or a config mismatch — boundaries for this layer will be missing.',
      );
      return [];
    }

    return mapFeaturesToRows(
      features,
      ctx,
      {
        ocdIdPrefix,
        jurisdictionType: layer.jurisdictionType,
        level: layer.level,
        nameField: layer.nameField,
        // TIGER convention: GEOID is the canonical fips_code source unless
        // the layer config overrides. Resolve the default here so the shared
        // builder doesn't need to know about per-source conventions.
        fipsField: layer.fipsField ?? DEFAULT_FIPS_FIELD,
        fipsPrefix: layer.fipsPrefix,
        districtField: layer.districtField,
        ocdIdSegment: layer.ocdIdSegment,
        nameTemplate: layer.nameTemplate,
        sourceLabel,
      },
      this.logger,
    );
  }

  /**
   * Fetch a layer's display geometry: the same features from the layer's
   * configured display source (typically the shoreline-clipped Census
   * cartographic version), keyed by the layer's own fipsField and
   * fipsPrefix. Display-only: nothing here touches `boundary`, which
   * address-to-district resolution reads (#1475).
   *
   * Fails closed like the main fetch: an unresolvable name, or a feature
   * with no key, is dropped with a log rather than guessed at. Null when the
   * layer has no display source.
   */
  async fetchDisplay(
    layer: TigerLayerConfig,
    ctx: RegionContext,
  ): Promise<DisplayBatch | null> {
    const display: DisplayLayerConfig | undefined = layer.display;
    if (!display) return null;

    const id = await this.resolveLayerId(
      display.url,
      display.layerName,
      'TigerFetcher (display)',
    );
    if (id === null) return { rows: [], sourceUrl: display.url };

    const sourceUrl = `${display.url}/${id}`;
    const fipsField = layer.fipsField ?? DEFAULT_FIPS_FIELD;
    const where = substituteVerbatim(layer.where ?? DEFAULT_WHERE, ctx);
    const features = await fetchPaginatedGeoJSON(sourceUrl, where, fipsField);

    const rows: DisplayRow[] = [];
    for (const feature of features) {
      const key = feature.properties?.[fipsField];
      if (
        key === undefined ||
        key === null ||
        key === '' ||
        !feature.geometry
      ) {
        continue;
      }
      rows.push({
        fipsCode: `${layer.fipsPrefix ?? ''}${String(key)}`,
        geometryGeoJSON: feature.geometry,
      });
    }
    if (rows.length === 0) {
      this.logger.warn(
        `TigerFetcher (display): 0 usable features from '${display.layerName}' ` +
          `(where=${where}) — this layer keeps whatever display geometry it had.`,
      );
    }
    return { rows, sourceUrl };
  }

  /**
   * Resolve the config's layer reference to a concrete `service/index` path.
   *
   * With `layerName` set, `layer` is the service root and the index is
   * resolved by exact name against the live service directory (see
   * pickLayerIdByName for why). Without it, the literal path passes through
   * — the legacy index-addressed form, kept for configs not yet migrated.
   *
   * Fail-closed: a name that resolves to nothing skips the layer with an
   * error listing what the service actually offers. Ingesting the wrong
   * legislature poisoned every district lookup while every health signal
   * stayed green; an absent layer is loudly detectable, so absence is the
   * only acceptable failure mode here.
   */
  private async resolveLayerPath(
    layer: TigerLayerConfig,
  ): Promise<string | null> {
    if (!layer.layerName) return layer.layer;

    const id = await this.resolveLayerId(
      `${TIGER_BASE}/${layer.layer}`,
      layer.layerName,
      'TigerFetcher',
    );
    return id === null ? null : `${layer.layer}/${id}`;
  }

  /**
   * A layer NAME → its current index in an ArcGIS service, or null with an
   * error naming what the service offers. Never an index fallback: see
   * pickLayerIdByName.
   */
  private async resolveLayerId(
    serviceUrl: string,
    layerName: string,
    label: string,
  ): Promise<number | null> {
    const directory = await fetchServiceDirectory(serviceUrl);
    if (!directory) {
      this.logger.error(
        `${label}: could not read service directory ${serviceUrl} — ` +
          `layer '${layerName}' skipped this load.`,
      );
      return null;
    }

    const id = pickLayerIdByName(directory, layerName);
    if (id === null) {
      const available = (directory.layers ?? [])
        .map((l) => `${l.id}:'${l.name}'`)
        .join(', ');
      this.logger.error(
        `${label}: no layer named '${layerName}' in ${serviceUrl}. ` +
          `A retired vintage (e.g. a new Congress) needs a deliberate config ` +
          `update, never an index fallback. Available: ${available}`,
      );
      return null;
    }

    this.logger.log(`${label}: '${layerName}' resolved to ${serviceUrl}/${id}`);
    return id;
  }
}

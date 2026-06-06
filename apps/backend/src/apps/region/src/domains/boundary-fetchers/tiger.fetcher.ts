import { Injectable, Logger } from '@nestjs/common';
import type { TigerLayerConfig } from '@opuspopuli/region-provider';
import {
  DEFAULT_FIPS_FIELD,
  fetchPaginatedGeoJSON,
  mapFeaturesToRows,
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
    const baseUrl = `${TIGER_BASE}/${layer.layer}`;
    const sourceLabel = `TigerFetcher: ${layer.layer}`;

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
}

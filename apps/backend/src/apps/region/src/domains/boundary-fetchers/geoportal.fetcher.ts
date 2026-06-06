import { Injectable, Logger } from '@nestjs/common';
import type { GeoportalLayerConfig } from '@opuspopuli/region-provider';
import {
  fetchPaginatedGeoJSON,
  mapFeaturesToRows,
  substituteVerbatim,
  type BoundaryRow,
  type RegionContext,
} from './arcgis.utils';

/**
 * Default WHERE clause when a GeoportalLayerConfig doesn't specify one.
 * Geoportal layers are typically state-scoped server-side (e.g. CALFIRE
 * fire districts are pre-filtered to CA), so a generic '1=1' returns the
 * full set the agency publishes.
 */
const DEFAULT_WHERE = '1=1';

/**
 * Generic ArcGIS FeatureServer fetcher for state geoportals and similar
 * agency-hosted services. Same machinery as TigerFetcher but reads the
 * full URL from the layer config (no hardcoded base) and falls back to
 * a different default WHERE clause. The row-mapping pass is delegated to
 * the shared `mapFeaturesToRows` helper.
 *
 * Same error semantics — returns [] on network failure so one bad
 * geoportal doesn't abort the rest of the region's load. See
 * opuspopuli#804.
 */
@Injectable()
export class GeoportalFetcher {
  private readonly logger = new Logger(GeoportalFetcher.name);

  async fetch(
    layer: GeoportalLayerConfig,
    ctx: RegionContext,
    ocdIdPrefix: string,
  ): Promise<BoundaryRow[]> {
    const where = substituteVerbatim(layer.where ?? DEFAULT_WHERE, ctx);
    const sourceLabel = `GeoportalFetcher: ${layer.url}`;

    const features = await fetchPaginatedGeoJSON(
      layer.url,
      where,
      layer.outFields,
    );

    if (features.length === 0) {
      this.logger.warn(
        `${sourceLabel}: 0 features (where=${where}). ` +
          'Either a transient outage or a config mismatch — boundaries for this layer will be missing.',
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
        // GeoportalLayerConfig.fipsField is optional and often absent —
        // pass through verbatim so the row builder falls back to the
        // ocdId upsert path when fipsField isn't configured. (No DEFAULT
        // here — Geoportal layers have no GEOID convention.)
        fipsField: layer.fipsField,
        fipsPrefix: layer.fipsPrefix,
        // Geoportal layers have no districtField — special districts
        // don't use district numbers.
        districtField: undefined,
        ocdIdSegment: layer.ocdIdSegment,
        nameTemplate: layer.nameTemplate,
        sourceLabel,
      },
      this.logger,
    );
  }
}

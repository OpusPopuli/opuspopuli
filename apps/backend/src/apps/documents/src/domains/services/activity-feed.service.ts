import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import {
  PetitionActivityFeed,
  PRIVACY_THRESHOLD,
} from '../dto/activity-feed.dto';

/**
 * Activity Feed Service
 *
 * Provides aggregated petition activity data for the last 24 hours.
 * Privacy-preserving: only petitions with >= PRIVACY_THRESHOLD scans are included.
 */
@Injectable()
export class ActivityFeedService {
  constructor(private readonly db: DbService) {}

  /**
   * Get aggregated petition activity feed for the last 24 hours.
   *
   * Privacy: Only petitions with >= PRIVACY_THRESHOLD scans are included.
   * Location counts use city-level precision (rounded to 0.01 degrees).
   * No individual user information is returned.
   */
  async getPetitionActivityFeed(): Promise<PetitionActivityFeed> {
    const results = await this.db.$queryRaw<
      Array<{
        items: Array<{
          content_hash: string;
          summary: string | null;
          document_type: string | null;
          scan_count: number;
          location_count: number;
          latest_scan_at: string;
          earliest_scan_at: string;
        }>;
        hourly_trend: Array<{
          hour: string;
          scan_count: number;
        }>;
        total_scans: number;
        active_petitions: number;
      }>
    >`
      WITH petition_base AS (
        SELECT *
        FROM documents
        WHERE type = 'petition'
          AND deleted_at IS NULL
          AND created_at >= NOW() - INTERVAL '24 hours'
      ),
      items AS (
        SELECT COALESCE(json_agg(t ORDER BY t.latest_scan_at DESC), '[]'::json) AS data
        FROM (
          SELECT
            content_hash,
            (MAX(analysis::json->>'summary'))::text as summary,
            MAX(type::text) as document_type,
            COUNT(*)::int as scan_count,
            COUNT(DISTINCT CONCAT(
              ROUND(ST_Y(scan_location::geometry)::numeric, 2),
              ',',
              ROUND(ST_X(scan_location::geometry)::numeric, 2)
            )) FILTER (WHERE scan_location IS NOT NULL)::int as location_count,
            MAX(created_at) as latest_scan_at,
            MIN(created_at) as earliest_scan_at
          FROM petition_base
          WHERE content_hash IS NOT NULL
          GROUP BY content_hash
          HAVING COUNT(*) >= ${PRIVACY_THRESHOLD}
          LIMIT 50
        ) t
      ),
      hourly AS (
        SELECT COALESCE(json_agg(t ORDER BY t.hour ASC), '[]'::json) AS data
        FROM (
          SELECT
            date_trunc('hour', created_at) as hour,
            COUNT(*)::int as scan_count
          FROM petition_base
          GROUP BY date_trunc('hour', created_at)
        ) t
      ),
      stats AS (
        SELECT
          COUNT(*)::int as total_scans,
          COUNT(DISTINCT content_hash) FILTER (WHERE content_hash IS NOT NULL)::int as active_petitions
        FROM petition_base
      )
      SELECT
        items.data as items,
        hourly.data as hourly_trend,
        stats.total_scans,
        stats.active_petitions
      FROM items, hourly, stats
    `;

    const row = results[0];
    const items = row?.items ?? [];
    const hourlyTrend = row?.hourly_trend ?? [];

    return {
      items: items.map((item) => ({
        contentHash: item.content_hash,
        summary: item.summary || 'Petition scan recorded',
        documentType: item.document_type ?? undefined,
        scanCount: Number(item.scan_count),
        locationCount: Number(item.location_count),
        latestScanAt: new Date(item.latest_scan_at),
        earliestScanAt: new Date(item.earliest_scan_at),
      })),
      hourlyTrend: hourlyTrend.map((bucket) => ({
        hour: new Date(bucket.hour),
        scanCount: Number(bucket.scan_count),
      })),
      totalScansLast24h: Number(row?.total_scans ?? 0),
      activePetitionsLast24h: Number(row?.active_petitions ?? 0),
    };
  }
}

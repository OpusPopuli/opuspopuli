import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import {
  GeoLocation,
  SetDocumentLocationResult,
  PetitionMapResult,
  PetitionMapStats,
  MapFiltersInput,
  fuzzLocation,
} from '../dto/location.dto';

/**
 * Location Service
 *
 * Handles geolocation and map features for documents.
 * Uses PostGIS for spatial queries. Coordinates are fuzzed
 * to ~100m accuracy for privacy.
 */
@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name, {
    timestamp: true,
  });

  constructor(private readonly db: DbService) {}

  /**
   * Set privacy-preserving scan location for a document
   *
   * Fuzzes coordinates to ~100m accuracy before storage.
   * See issues #290, #296 for privacy design.
   */
  async setDocumentLocation(
    userId: string,
    documentId: string,
    latitude: number,
    longitude: number,
  ): Promise<SetDocumentLocationResult> {
    // Verify document ownership
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Fuzz location for privacy (~100m accuracy)
    const fuzzedLocation = fuzzLocation(latitude, longitude);

    // Use raw SQL to set PostGIS geography point
    // PostGIS uses POINT(longitude latitude) format
    // Note: Cast column to text (not param to uuid) because Prisma passes params as text
    await this.db.$executeRaw`
      UPDATE documents
      SET scan_location = ST_SetSRID(ST_MakePoint(${fuzzedLocation.longitude}, ${fuzzedLocation.latitude}), 4326)::geography
      WHERE id::text = ${documentId}
    `;

    this.logger.log(
      `Set scan location for document ${documentId} (fuzzed to ~100m)`,
    );

    return {
      success: true,
      fuzzedLocation,
    };
  }

  /**
   * Get scan location for a document
   */
  async getDocumentLocation(
    userId: string,
    documentId: string,
  ): Promise<GeoLocation | null> {
    // Verify document ownership
    const document = await this.db.document.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Use raw SQL to extract coordinates from PostGIS geography
    // Note: Cast column to text (not param to uuid) because Prisma passes params as text
    const result = await this.db.$queryRaw<
      Array<{ latitude: number; longitude: number }>
    >`
      SELECT
        ST_Y(scan_location::geometry) as latitude,
        ST_X(scan_location::geometry) as longitude
      FROM documents
      WHERE id::text = ${documentId} AND scan_location IS NOT NULL
    `;

    if (result.length === 0) {
      return null;
    }

    return {
      latitude: result[0].latitude,
      longitude: result[0].longitude,
    };
  }

  private static readonly MAX_MAP_LIMIT = 1000;
  private static readonly DEFAULT_MAP_LIMIT = 1000;

  /**
   * Get petition locations for map display with spatial pagination (#465)
   * Returns documents with scan locations, optionally filtered by bounds/type/date
   * Coordinates are already fuzzed at write time, safe to return directly
   */
  async getPetitionMapLocations(
    filters?: MapFiltersInput,
  ): Promise<PetitionMapResult> {
    const conditions: string[] = ['scan_location IS NOT NULL'];
    const params: unknown[] = [];

    if (filters?.bounds) {
      const i = params.length + 1;
      conditions.push(
        `ST_Within(scan_location::geometry, ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326))`,
      );
      params.push(
        filters.bounds.swLng,
        filters.bounds.swLat,
        filters.bounds.neLng,
        filters.bounds.neLat,
      );
    }

    if (filters?.documentType) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(filters.documentType);
    }

    if (filters?.startDate) {
      conditions.push(`created_at >= $${params.length + 1}`);
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      conditions.push(`created_at <= $${params.length + 1}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const limit = Math.min(
      filters?.limit ?? LocationService.DEFAULT_MAP_LIMIT,
      LocationService.MAX_MAP_LIMIT,
    );

    // Run count and data queries in parallel
    const [countResult, results] = await Promise.all([
      this.db.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM documents WHERE ${whereClause}`,
        ...params,
      ),
      this.db.$queryRawUnsafe<
        Array<{
          id: string;
          latitude: number;
          longitude: number;
          document_type: string | null;
          created_at: Date;
        }>
      >(
        `SELECT
          id::text as id,
          ST_Y(scan_location::geometry) as latitude,
          ST_X(scan_location::geometry) as longitude,
          type as document_type,
          created_at
        FROM documents
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
        ...params,
      ),
    ]);

    const totalCount = Number(countResult[0]?.count ?? 0);

    return {
      markers: results.map((r) => ({
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        documentType: r.document_type ?? undefined,
        createdAt: r.created_at,
      })),
      totalCount,
      truncated: totalCount > limit,
    };
  }

  /**
   * Get aggregated stats for the petition map sidebar
   */
  async getPetitionMapStats(): Promise<PetitionMapStats> {
    const results = await this.db.$queryRaw<
      Array<{
        total_petitions: bigint;
        total_with_location: bigint;
        recent_petitions: bigint;
      }>
    >`
      SELECT
        COUNT(*) as total_petitions,
        COUNT(scan_location) as total_with_location,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as recent_petitions
      FROM documents
      WHERE type = 'petition' AND deleted_at IS NULL
    `;

    const stats = results[0];
    return {
      totalPetitions: Number(stats?.total_petitions ?? 0),
      totalWithLocation: Number(stats?.total_with_location ?? 0),
      recentPetitions: Number(stats?.recent_petitions ?? 0),
    };
  }

  /**
   * Find documents scanned near a location
   *
   * Returns documents within the specified radius (in meters)
   * that match the given content hash (same petition/document).
   */
  async findDocumentsNearLocation(
    contentHash: string,
    latitude: number,
    longitude: number,
    radiusMeters: number = 10000, // Default 10km
  ): Promise<Array<{ documentId: string; distanceMeters: number }>> {
    const results = await this.db.$queryRaw<
      Array<{ id: string; distance_meters: number }>
    >`
      SELECT
        id,
        ST_Distance(
          scan_location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        ) as distance_meters
      FROM documents
      WHERE
        content_hash = ${contentHash}
        AND scan_location IS NOT NULL
        AND ST_DWithin(
          scan_location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY distance_meters ASC
    `;

    return results.map((r) => ({
      documentId: r.id,
      distanceMeters: r.distance_meters,
    }));
  }
}

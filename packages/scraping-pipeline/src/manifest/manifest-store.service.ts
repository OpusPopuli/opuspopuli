/**
 * Manifest Store Service
 *
 * Persists and retrieves structural manifests from the database.
 * Handles versioning, active/inactive state, and success/failure tracking.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { StructuralManifest, DataType } from "@opuspopuli/common";

/**
 * Database interface for manifest persistence.
 * Decoupled from Prisma to allow different storage implementations.
 */
export interface ManifestRepository {
  findFirst(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string>;
  }): Promise<ManifestRecord | null>;

  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string> | Record<string, string>[];
    take?: number;
  }): Promise<ManifestRecord[]>;

  create(args: {
    data: Omit<ManifestRecord, "updatedAt">;
  }): Promise<ManifestRecord>;

  update(args: {
    where: { id: string };
    data: Partial<ManifestRecord>;
  }): Promise<ManifestRecord>;

  updateMany(args: {
    where: Record<string, unknown>;
    data: Partial<ManifestRecord>;
  }): Promise<{ count: number }>;
}

export interface ManifestRecord {
  id: string;
  regionId: string;
  sourceUrl: string;
  dataType: string;
  version: number;
  structureHash: string;
  promptHash: string;
  extractionRules: unknown;
  confidence: number;
  successCount: number;
  failureCount: number;
  isActive: boolean;
  llmProvider: string | null;
  llmModel: string | null;
  llmTokensUsed: number | null;
  analysisTimeMs: number | null;
  lastUsedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ManifestStoreService {
  private readonly logger = new Logger(ManifestStoreService.name);

  constructor(private readonly repository: ManifestRepository) {}

  /**
   * Return the next version number to use when saving a new manifest for
   * a source. Queries across ALL rows (active or not), because the unique
   * constraint on (regionId, sourceUrl, dataType, version) is
   * history-wide — using `findLatest` (which is active-only) can produce
   * a version number that already exists as an inactive row, colliding
   * on insert.
   *
   * This can occur when a prior save failed between its updateMany
   * (deactivate old) and create (insert new) steps, leaving a source
   * with no active manifest but a tail of inactive versions. See
   * #629 for the transactional-save follow-up.
   */
  async getNextVersion(
    regionId: string,
    sourceUrl: string,
    dataType: DataType,
  ): Promise<number> {
    const [latest] = await this.repository.findMany({
      where: {
        regionId,
        sourceUrl,
        dataType: dataType as string,
      },
      orderBy: { version: "desc" },
      take: 1,
    });
    return latest ? latest.version + 1 : 1;
  }

  /**
   * Find the latest active manifest for a source.
   */
  async findLatest(
    regionId: string,
    sourceUrl: string,
    dataType: DataType,
  ): Promise<StructuralManifest | undefined> {
    const record = await this.repository.findFirst({
      where: {
        regionId,
        sourceUrl,
        dataType: dataType as string,
        isActive: true,
      },
      orderBy: { version: "desc" },
    });

    return record ? this.toManifest(record) : undefined;
  }

  /**
   * Save a new manifest version.
   * Deactivates previous versions for the same (regionId, sourceUrl, dataType).
   */
  async save(manifest: StructuralManifest): Promise<StructuralManifest> {
    // Deactivate previous versions
    await this.repository.updateMany({
      where: {
        regionId: manifest.regionId,
        sourceUrl: manifest.sourceUrl,
        dataType: manifest.dataType as string,
        isActive: true,
      },
      data: { isActive: false },
    });

    // Create new version
    const record = await this.repository.create({
      data: {
        id: manifest.id,
        regionId: manifest.regionId,
        sourceUrl: manifest.sourceUrl,
        dataType: manifest.dataType as string,
        version: manifest.version,
        structureHash: manifest.structureHash,
        promptHash: manifest.promptHash,
        extractionRules: manifest.extractionRules as unknown,
        confidence: manifest.confidence,
        successCount: 0,
        failureCount: 0,
        isActive: true,
        llmProvider: manifest.llmProvider ?? null,
        llmModel: manifest.llmModel ?? null,
        llmTokensUsed: manifest.llmTokensUsed ?? null,
        analysisTimeMs: manifest.analysisTimeMs ?? null,
        lastUsedAt: null,
        lastCheckedAt: manifest.lastCheckedAt ?? null,
        createdAt: manifest.createdAt,
      },
    });

    this.logger.log(
      `Saved manifest v${manifest.version} for ${manifest.regionId}/${manifest.sourceUrl}/${manifest.dataType}`,
    );

    return this.toManifest(record);
  }

  /**
   * Record a successful extraction using this manifest.
   */
  async incrementSuccess(manifestId: string): Promise<void> {
    const record = await this.repository.findFirst({
      where: { id: manifestId },
    });
    if (record) {
      await this.repository.update({
        where: { id: manifestId },
        data: {
          successCount: record.successCount + 1,
          lastUsedAt: new Date(),
        },
      });
    }
  }

  /**
   * Record a failed extraction using this manifest.
   */
  async incrementFailure(manifestId: string): Promise<void> {
    const record = await this.repository.findFirst({
      where: { id: manifestId },
    });
    if (record) {
      await this.repository.update({
        where: { id: manifestId },
        data: {
          failureCount: record.failureCount + 1,
        },
      });
    }
  }

  /**
   * Get version history for a source.
   */
  async getHistory(
    regionId: string,
    sourceUrl: string,
    dataType: DataType,
    limit: number = 10,
  ): Promise<StructuralManifest[]> {
    const records = await this.repository.findMany({
      where: {
        regionId,
        sourceUrl,
        dataType: dataType as string,
      },
      orderBy: { version: "desc" },
      take: limit,
    });

    return records.map((r) => this.toManifest(r));
  }

  /**
   * Deactivate all active manifests for a source so the next sync triggers
   * a fresh structural analysis. Returns the number of records deactivated.
   */
  async invalidate(
    regionId: string,
    sourceUrl: string,
    dataType?: DataType,
  ): Promise<number> {
    const where = dataType
      ? { regionId, sourceUrl, dataType: dataType as string, isActive: true }
      : { regionId, sourceUrl, isActive: true };

    const result = await this.repository.updateMany({
      where,
      data: { isActive: false },
    });

    this.logger.log(
      `Invalidated ${result.count} manifest(s) for ${regionId}/${sourceUrl}`,
    );
    return result.count;
  }

  /**
   * Update the lastCheckedAt timestamp for a manifest.
   */
  async markChecked(manifestId: string): Promise<void> {
    await this.repository.update({
      where: { id: manifestId },
      data: { lastCheckedAt: new Date() },
    });
  }

  /**
   * Convert a database record to a StructuralManifest.
   */
  private toManifest(record: ManifestRecord): StructuralManifest {
    return {
      id: record.id,
      regionId: record.regionId,
      sourceUrl: record.sourceUrl,
      dataType: record.dataType as DataType,
      version: record.version,
      structureHash: record.structureHash,
      promptHash: record.promptHash,
      extractionRules:
        record.extractionRules as StructuralManifest["extractionRules"],
      confidence: record.confidence,
      successCount: record.successCount,
      failureCount: record.failureCount,
      isActive: record.isActive,
      llmProvider: record.llmProvider ?? undefined,
      llmModel: record.llmModel ?? undefined,
      llmTokensUsed: record.llmTokensUsed ?? undefined,
      analysisTimeMs: record.analysisTimeMs ?? undefined,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt ?? undefined,
      lastCheckedAt: record.lastCheckedAt ?? undefined,
    };
  }
}

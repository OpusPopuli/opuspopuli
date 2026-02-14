/**
 * Manifest Store Service
 *
 * Persists and retrieves structural manifests from the database.
 * Handles versioning, active/inactive state, and success/failure tracking.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { StructuralManifest, CivicDataType } from "@opuspopuli/common";

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
   * Find the latest active manifest for a source.
   */
  async findLatest(
    regionId: string,
    sourceUrl: string,
    dataType: CivicDataType,
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
    dataType: CivicDataType,
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
      dataType: record.dataType as CivicDataType,
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

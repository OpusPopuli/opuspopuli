/**
 * Ingestion Watermark Service
 *
 * Tracks the most recently ingested item per (region, sourceUrl,
 * dataType) for cold-start protection on listing-walk sources (CA
 * Assembly daily journals, federal Congressional Record, etc.).
 *
 * The pdf_archive handler reads the watermark before walking the
 * listing page and stops descending once it hits a previously-seen
 * `lastExternalId`. After a successful walk, the watermark advances
 * to the most recent ingested item.
 *
 * Repository abstraction mirrors `manifest-store.service.ts` so
 * consumers can wire any persistence backend (Prisma is the prod
 * default; tests use an in-memory fake).
 */

import { Injectable, Logger } from "@nestjs/common";

export interface IngestionWatermarkRecord {
  id: string;
  regionId: string;
  sourceUrl: string;
  dataType: string;
  lastExternalId: string | null;
  lastIngestedAt: Date | null;
  itemsIngested: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IngestionWatermarkRepository {
  findFirst(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
  }): Promise<IngestionWatermarkRecord | null>;

  upsert(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
    create: Omit<IngestionWatermarkRecord, "createdAt" | "updatedAt">;
    update: Partial<
      Omit<
        IngestionWatermarkRecord,
        "id" | "regionId" | "sourceUrl" | "dataType" | "createdAt"
      >
    >;
  }): Promise<IngestionWatermarkRecord>;
}

export interface IngestionWatermark {
  regionId: string;
  sourceUrl: string;
  dataType: string;
  lastExternalId?: string;
  lastIngestedAt?: Date;
  itemsIngested: number;
}

@Injectable()
export class IngestionWatermarkService {
  private readonly logger = new Logger(IngestionWatermarkService.name);

  constructor(private readonly repository: IngestionWatermarkRepository) {}

  async read(
    regionId: string,
    sourceUrl: string,
    dataType: string,
  ): Promise<IngestionWatermark | undefined> {
    const record = await this.repository.findFirst({
      where: { regionId, sourceUrl, dataType },
    });
    return record ? this.toWatermark(record) : undefined;
  }

  /**
   * Advance the watermark to a new high-water mark. `itemsIngestedDelta`
   * is added to the running counter so the per-cycle volume can be
   * surfaced on a long-lived row without read-modify-write churn.
   */
  async advance(
    regionId: string,
    sourceUrl: string,
    dataType: string,
    lastExternalId: string,
    itemsIngestedDelta: number,
  ): Promise<IngestionWatermark> {
    const now = new Date();
    const record = await this.repository.upsert({
      where: { regionId, sourceUrl, dataType },
      create: {
        id: crypto.randomUUID(),
        regionId,
        sourceUrl,
        dataType,
        lastExternalId,
        lastIngestedAt: now,
        itemsIngested: itemsIngestedDelta,
      },
      update: {
        lastExternalId,
        lastIngestedAt: now,
        itemsIngested: { increment: itemsIngestedDelta } as unknown as number,
      },
    });
    this.logger.log(
      `Watermark advanced: ${regionId}/${dataType}@${sourceUrl} → ${lastExternalId} (+${itemsIngestedDelta})`,
    );
    return this.toWatermark(record);
  }

  private toWatermark(record: IngestionWatermarkRecord): IngestionWatermark {
    return {
      regionId: record.regionId,
      sourceUrl: record.sourceUrl,
      dataType: record.dataType,
      lastExternalId: record.lastExternalId ?? undefined,
      lastIngestedAt: record.lastIngestedAt ?? undefined,
      itemsIngested: record.itemsIngested,
    };
  }
}

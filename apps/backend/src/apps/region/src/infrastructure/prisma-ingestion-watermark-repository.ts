/**
 * Prisma Ingestion-Watermark Repository
 *
 * Adapts DbService (PrismaClient) to the IngestionWatermarkRepository
 * interface expected by the scraping pipeline's
 * IngestionWatermarkService. Mirrors PrismaManifestRepository's shape.
 */

import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

@Injectable()
export class PrismaIngestionWatermarkRepository {
  constructor(private readonly db: DbService) {}

  async findFirst(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
  }) {
    return this.db.ingestionWatermark.findFirst({
      where: args.where,
    });
  }

  async upsert(args: {
    where: { regionId: string; sourceUrl: string; dataType: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) {
    return this.db.ingestionWatermark.upsert({
      where: {
        regionId_sourceUrl_dataType: args.where,
      } as never,
      create: args.create as never,
      update: args.update as never,
    });
  }
}

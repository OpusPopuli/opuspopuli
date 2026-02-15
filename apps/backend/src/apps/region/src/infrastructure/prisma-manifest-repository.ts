/**
 * Prisma Manifest Repository
 *
 * Adapts DbService (PrismaClient) to the ManifestRepository interface
 * expected by the scraping pipeline's ManifestStoreService.
 */

import { Injectable } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

@Injectable()
export class PrismaManifestRepository {
  constructor(private readonly db: DbService) {}

  async findFirst(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string>;
  }) {
    return this.db.structuralManifest.findFirst({
      where: args.where,
      orderBy: args.orderBy as never,
    });
  }

  async findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string> | Record<string, string>[];
    take?: number;
  }) {
    return this.db.structuralManifest.findMany({
      where: args.where,
      orderBy: args.orderBy as never,
      take: args.take,
    });
  }

  async create(args: { data: Record<string, unknown> }) {
    return this.db.structuralManifest.create({
      data: args.data as never,
    });
  }

  async update(args: { where: { id: string }; data: Record<string, unknown> }) {
    return this.db.structuralManifest.update({
      where: args.where,
      data: args.data as never,
    });
  }

  async updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) {
    return this.db.structuralManifest.updateMany({
      where: args.where,
      data: args.data as never,
    });
  }
}

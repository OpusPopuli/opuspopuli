import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
  isDevelopment,
  isTest,
  IRelationalDBProvider,
  RelationalDBType,
} from "@qckstrt/common";

/**
 * DbService extends PrismaClient to provide NestJS lifecycle hooks
 * for proper connection management.
 *
 * This service implements the IRelationalDBProvider interface, allowing
 * it to be used as a pluggable database provider.
 */
@Injectable()
export class DbService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, IRelationalDBProvider
{
  private readonly logger = new Logger(DbService.name);

  constructor() {
    super({
      log: isDevelopment()
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "info" },
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [{ emit: "stdout", level: "error" }],
    });
  }

  // ============================================
  // NestJS Lifecycle Hooks
  // ============================================

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  // ============================================
  // IRelationalDBProvider Implementation
  // ============================================

  getName(): string {
    return "Prisma PostgreSQL";
  }

  getType(): RelationalDBType {
    return RelationalDBType.PostgreSQL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to database");
  }

  async disconnect(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Disconnected from database");
  }

  // ============================================
  // Test Utilities
  // ============================================

  /**
   * Clean database for testing purposes.
   * WARNING: This deletes all data - use only in test environments.
   */
  async cleanDatabase() {
    if (!isTest()) {
      throw new Error("cleanDatabase can only be used in test environment");
    }

    // Delete in order respecting foreign key constraints
    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    for (const { tablename } of tablenames) {
      if (tablename !== "_prisma_migrations") {
        try {
          await this.$executeRawUnsafe(
            `TRUNCATE TABLE "public"."${tablename}" CASCADE;`,
          );
        } catch {
          this.logger.warn(`Could not truncate table ${tablename}`);
        }
      }
    }
  }
}

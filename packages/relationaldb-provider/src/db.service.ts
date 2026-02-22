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
} from "@opuspopuli/common";

/**
 * DbService extends PrismaClient to provide NestJS lifecycle hooks
 * for proper connection management.
 *
 * This service implements the IRelationalDBProvider interface, allowing
 * it to be used as a pluggable database provider.
 *
 * Connection pool parameters (PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT)
 * are injected into DATABASE_URL as query parameters at startup.
 */
@Injectable()
export class DbService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, IRelationalDBProvider
{
  private readonly logger = new Logger(DbService.name);

  constructor() {
    const datasourceUrl = DbService.buildDatasourceUrl();

    super({
      ...(datasourceUrl ? { datasourceUrl } : {}),
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

  /**
   * Build a datasource URL with pool parameters from environment variables.
   * Returns undefined if no pool env vars are set (Prisma uses DATABASE_URL directly).
   */
  static buildDatasourceUrl(): string | undefined {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) return undefined;

    const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT;
    const poolTimeout = process.env.PRISMA_POOL_TIMEOUT;

    if (!connectionLimit && !poolTimeout) return undefined;

    try {
      const url = new URL(baseUrl);
      if (connectionLimit)
        url.searchParams.set("connection_limit", connectionLimit);
      if (poolTimeout) url.searchParams.set("pool_timeout", poolTimeout);
      return url.toString();
    } catch {
      return undefined;
    }
  }

  // ============================================
  // NestJS Lifecycle Hooks
  // ============================================

  async onModuleInit() {
    await this.connect();

    const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT;
    const poolTimeout = process.env.PRISMA_POOL_TIMEOUT;
    if (connectionLimit || poolTimeout) {
      this.logger.log(
        `Pool config: connection_limit=${connectionLimit || "default"}, pool_timeout=${poolTimeout || "default"}`,
      );
    }
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
  // Pool Metrics (requires "metrics" preview feature)
  // ============================================

  /**
   * Get connection pool metrics from Prisma's metrics API.
   * Returns null if metrics are unavailable.
   */
  async getPoolMetrics(): Promise<{
    open: number;
    idle: number;
    busy: number;
  } | null> {
    try {
      const metrics = await this.$metrics.json();
      const gauges = metrics.gauges;

      const open =
        gauges.find((g) => g.key === "prisma_pool_connections_open")?.value ??
        0;
      const idle =
        gauges.find((g) => g.key === "prisma_pool_connections_idle")?.value ??
        0;
      const busy = open - idle;

      return { open, idle, busy };
    } catch {
      return null;
    }
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

    // Tables that should never be truncated:
    // - _prisma_migrations: Prisma migration history
    // - spatial_ref_sys: PostGIS spatial reference system (required for SRID lookups)
    const preservedTables = new Set(["_prisma_migrations", "spatial_ref_sys"]);

    // Delete in order respecting foreign key constraints
    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    for (const { tablename } of tablenames) {
      if (!preservedTables.has(tablename)) {
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

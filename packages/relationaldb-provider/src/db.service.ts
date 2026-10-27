import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Optional,
} from "@nestjs/common";
import { cpus } from "node:os";
import { PrismaClient } from "@prisma/client";
import {
  DbLaneMetric,
  isDevelopment,
  isTest,
  IRelationalDBProvider,
  METRICS_OBSERVER,
  RelationalDBType,
  type MetricsObserver,
} from "@opuspopuli/common";

/**
 * One of Prisma's query histograms (`$metrics.json()`), in seconds with
 * CUMULATIVE bucket counts — the Prometheus shape. Prisma reports milliseconds
 * and per-bucket counts.
 */
export interface DbLaneHistogram {
  /** `[upper bound in seconds, observations at or below it]`, ascending. */
  buckets: Array<[number, number]>;
  sum: number;
  count: number;
}

/** The DB lane's three histograms (`docs/plans/db-lane.md`). */
export interface DbLaneHistograms {
  /** Waiting for a pool connection — the lane's queue. */
  wait: DbLaneHistogram;
  /** Inside the database. */
  query: DbLaneHistogram;
  /** The whole query, as the client saw it. */
  total: DbLaneHistogram;
}

const PRISMA_HISTOGRAMS: Record<keyof DbLaneHistograms, string> = {
  wait: "prisma_client_queries_wait_histogram_ms",
  query: "prisma_datasource_queries_duration_histogram_ms",
  total: "prisma_client_queries_duration_histogram_ms",
};

type PrismaHistogramValue = {
  buckets: Array<[number, number]>;
  sum: number;
  count: number;
};

const STATEMENTS = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
]);
const TABLE = /\b(?:FROM|INTO|UPDATE|JOIN)\s+"\w+"\."(\w+)"/i;

/**
 * `table` and `statement` labels for one SQL statement. Bounded by
 * construction: `statement` is one of a closed set (else `OTHER`), and
 * `table` is a schema-qualified table the statement names (else `none` —
 * a BEGIN, a COMMIT, a raw query without one) — never anything taken from
 * parameters or values.
 */
export function statementLabels(sql: string): {
  table: string;
  statement: string;
} {
  const first = /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase() ?? "";
  return {
    table: TABLE.exec(sql)?.[1] ?? "none",
    statement: STATEMENTS.has(first) ? first : "OTHER",
  };
}

/** Milliseconds and per-bucket counts → seconds and cumulative counts. */
export function toLaneHistogram(value: PrismaHistogramValue): DbLaneHistogram {
  let running = 0;
  return {
    buckets: value.buckets.map(([leMs, n]) => {
      running += n;
      return [leMs / 1000, running];
    }),
    sum: value.sum / 1000,
    count: value.count,
  };
}

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

  constructor(
    /**
     * Where each query's time goes — the DB lane (`docs/plans/db-lane.md`).
     * Optional: the eval harness and the integration cleanup construct this
     * with `new DbService()`, and a query must not depend on being measured.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
  ) {
    const datasourceUrl = DbService.buildDatasourceUrl();
    // The DB lane's per-statement timings (`docs/plans/db-lane.md`). On by
    // default where metrics are bound; `DB_LANE_STATEMENT_METRICS=false`
    // turns the query event off — Prisma serialises every statement AND its
    // bind values into it, which is the cost to measure on a bulk write path.
    const statementMetrics =
      metrics !== undefined &&
      process.env.DB_LANE_STATEMENT_METRICS !== "false";

    super({
      ...(datasourceUrl ? { datasourceUrl } : {}),
      log: isDevelopment()
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "info" },
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [
            // An event, never printed.
            ...(statementMetrics
              ? [{ emit: "event" as const, level: "query" as const }]
              : []),
            { emit: "stdout", level: "error" },
          ],
    });

    // Every SQL statement's time, by table (the DB lane). From Prisma's query
    // EVENT, not its middleware: a batched `$transaction([...])` resolves
    // every operation in it together, so middleware timed each of 50 upserts
    // as the whole batch — 14 s of "busy" for 0.3 s of work, measured on UAT.
    // The event carries the engine's own duration, one per statement.
    //
    // The event also carries `params` — every bind value, personal data
    // included. It is NEVER read here: only the SQL text, and only through
    // `statementLabels`, which keeps a table name and a statement keyword.
    if (statementMetrics) {
      (
        this as unknown as {
          $on(
            event: "query",
            cb: (e: { query: string; duration: number }) => void,
          ): void;
        }
      ).$on("query", (e) => this.countStatement(e.query, e.duration / 1000));
    }
  }

  private countStatement(sql: string, seconds: number): void {
    try {
      this.metrics?.increment(
        DbLaneMetric.BusySecondsTotal,
        seconds,
        statementLabels(sql),
      );
    } catch {
      // A measurement never fails the query it measured.
    }
  }

  /**
   * The pool's bound, and whether it is known or estimated: an explicit
   * `connection_limit` (from `PRISMA_CONNECTION_LIMIT`, or already on
   * `DATABASE_URL`), else Prisma's documented default of `num_cpus * 2 + 1` —
   * estimated from LOGICAL cores, which overstates it on an SMT host, where
   * Prisma counts physical ones.
   */
  static poolSize(): { size: number; estimated: boolean } {
    const fromEnv = Number(process.env.PRISMA_CONNECTION_LIMIT);
    if (Number.isSafeInteger(fromEnv) && fromEnv > 0) {
      return { size: fromEnv, estimated: false };
    }
    try {
      const fromUrl = Number(
        new URL(process.env.DATABASE_URL ?? "").searchParams.get(
          "connection_limit",
        ),
      );
      if (Number.isSafeInteger(fromUrl) && fromUrl > 0) {
        return { size: fromUrl, estimated: false };
      }
    } catch {
      // No usable DATABASE_URL: estimate.
    }
    return { size: cpus().length * 2 + 1, estimated: true };
  }

  /**
   * Prisma's query histograms as the DB lane's (`docs/plans/db-lane.md`), or
   * null when metrics are unavailable. Cumulative since the client started,
   * as a Prometheus histogram is.
   */
  async getLaneHistograms(): Promise<DbLaneHistograms | null> {
    try {
      const { histograms } = await this.$metrics.json();
      const find = (key: string) =>
        histograms.find((h: { key: string }) => h.key === key)?.value as
          | PrismaHistogramValue
          | undefined;
      const out: Partial<DbLaneHistograms> = {};
      for (const [name, key] of Object.entries(PRISMA_HISTOGRAMS)) {
        const value = find(key);
        if (!value) return null;
        out[name as keyof DbLaneHistograms] = toLaneHistogram(value);
      }
      return out as DbLaneHistograms;
    } catch {
      return null;
    }
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
      // Only a usable value reaches the URL — and therefore the bound
      // `poolSize()` reports is the bound Prisma uses.
      if (connectionLimit && /^[1-9]\d*$/.test(connectionLimit))
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
        gauges.find(
          (g: { key: string; value: number }) =>
            g.key === "prisma_pool_connections_open",
        )?.value ?? 0;
      const idle =
        gauges.find(
          (g: { key: string; value: number }) =>
            g.key === "prisma_pool_connections_idle",
        )?.value ?? 0;
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

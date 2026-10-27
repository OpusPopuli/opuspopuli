import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { RelationalDBType } from "@opuspopuli/common";

// Mock PrismaClient methods - define mocks before import
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockQueryRaw = jest.fn();
const mockExecuteRawUnsafe = jest.fn();
const mockMetricsJson = jest.fn();
const mockOn = jest.fn();

jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(function (this: object) {
      Object.assign(this, {
        $connect: mockConnect,
        $disconnect: mockDisconnect,
        $queryRaw: mockQueryRaw,
        $executeRawUnsafe: mockExecuteRawUnsafe,
        $metrics: { json: mockMetricsJson },
        $on: mockOn,
      });
      return this;
    }),
  };
});

// Mock @opuspopuli/common environment functions
jest.mock("@opuspopuli/common", () => ({
  ...jest.requireActual("@opuspopuli/common"),
  isDevelopment: jest.fn().mockReturnValue(false),
  isTest: jest.fn().mockReturnValue(true),
}));

// Import DbService after mocks are set up
import { DbService, statementLabels, toLaneHistogram } from "../src/db.service";

describe("DbService", () => {
  let service: DbService;
  let module: TestingModule;

  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    module = await Test.createTestingModule({
      providers: [DbService],
    }).compile();

    service = module.get<DbService>(DbService);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await module?.close();
  });

  describe("constructor", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });
  });

  describe("buildDatasourceUrl", () => {
    it("should return undefined when DATABASE_URL is not set", () => {
      delete process.env.DATABASE_URL;
      delete process.env.PRISMA_CONNECTION_LIMIT;
      delete process.env.PRISMA_POOL_TIMEOUT;

      expect(DbService.buildDatasourceUrl()).toBeUndefined();
    });

    it("should return undefined when no pool env vars are set", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      delete process.env.PRISMA_CONNECTION_LIMIT;
      delete process.env.PRISMA_POOL_TIMEOUT;

      expect(DbService.buildDatasourceUrl()).toBeUndefined();
    });

    it("should append connection_limit when PRISMA_CONNECTION_LIMIT is set", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.PRISMA_CONNECTION_LIMIT = "20";
      delete process.env.PRISMA_POOL_TIMEOUT;

      const result = DbService.buildDatasourceUrl();
      expect(result).toContain("connection_limit=20");
    });

    it("should append pool_timeout when PRISMA_POOL_TIMEOUT is set", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      delete process.env.PRISMA_CONNECTION_LIMIT;
      process.env.PRISMA_POOL_TIMEOUT = "15";

      const result = DbService.buildDatasourceUrl();
      expect(result).toContain("pool_timeout=15");
    });

    it("should append both params when both are set", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.PRISMA_CONNECTION_LIMIT = "20";
      process.env.PRISMA_POOL_TIMEOUT = "15";

      const result = DbService.buildDatasourceUrl();
      expect(result).toContain("connection_limit=20");
      expect(result).toContain("pool_timeout=15");
    });

    it("should return undefined for invalid URL", () => {
      process.env.DATABASE_URL = "not-a-valid-url";
      process.env.PRISMA_CONNECTION_LIMIT = "20";

      expect(DbService.buildDatasourceUrl()).toBeUndefined();
    });
  });

  describe("IRelationalDBProvider implementation", () => {
    it("should return correct name", () => {
      expect(service.getName()).toBe("Prisma PostgreSQL");
    });

    it("should return correct type", () => {
      expect(service.getType()).toBe(RelationalDBType.PostgreSQL);
    });
  });

  describe("connect", () => {
    it("should call $connect", async () => {
      mockConnect.mockClear();
      await service.connect();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should call $disconnect", async () => {
      await service.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("isAvailable", () => {
    it("should return true when database is available", async () => {
      mockQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
      const result = await service.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when database query fails", async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error("Connection failed"));
      const result = await service.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("NestJS lifecycle hooks", () => {
    it("should connect on module init", async () => {
      mockConnect.mockClear();
      await service.onModuleInit();
      expect(mockConnect).toHaveBeenCalled();
    });

    it("should disconnect on module destroy", async () => {
      await service.onModuleDestroy();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("getPoolMetrics", () => {
    it("should return pool metrics from Prisma metrics API", async () => {
      mockMetricsJson.mockResolvedValue({
        counters: [],
        gauges: [
          { key: "prisma_pool_connections_open", value: 5 },
          { key: "prisma_pool_connections_idle", value: 3 },
        ],
        histograms: [],
      });

      const result = await service.getPoolMetrics();

      expect(result).toEqual({ open: 5, idle: 3, busy: 2 });
    });

    it("should return null when metrics are unavailable", async () => {
      mockMetricsJson.mockRejectedValue(new Error("Not available"));

      const result = await service.getPoolMetrics();

      expect(result).toBeNull();
    });

    it("should default to 0 for missing gauge values", async () => {
      mockMetricsJson.mockResolvedValue({
        counters: [],
        gauges: [],
        histograms: [],
      });

      const result = await service.getPoolMetrics();

      expect(result).toEqual({ open: 0, idle: 0, busy: 0 });
    });
  });

  describe("cleanDatabase", () => {
    it("should truncate all tables in test environment", async () => {
      const { isTest } = require("@opuspopuli/common");
      (isTest as jest.Mock).mockReturnValue(true);

      mockQueryRaw.mockResolvedValueOnce([
        { tablename: "users" },
        { tablename: "documents" },
        { tablename: "_prisma_migrations" },
      ]);
      mockExecuteRawUnsafe.mockResolvedValue(undefined);

      await service.cleanDatabase();

      // Should truncate users and documents but not _prisma_migrations
      expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
        'TRUNCATE TABLE "public"."users" CASCADE;',
      );
      expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
        'TRUNCATE TABLE "public"."documents" CASCADE;',
      );
    });

    it("should throw error if not in test environment", async () => {
      const { isTest } = require("@opuspopuli/common");
      (isTest as jest.Mock).mockReturnValue(false);

      await expect(service.cleanDatabase()).rejects.toThrow(
        "cleanDatabase can only be used in test environment",
      );
    });

    it("should handle truncate errors gracefully", async () => {
      const { isTest } = require("@opuspopuli/common");
      (isTest as jest.Mock).mockReturnValue(true);

      mockQueryRaw.mockResolvedValueOnce([{ tablename: "users" }]);
      mockExecuteRawUnsafe.mockRejectedValueOnce(new Error("Cannot truncate"));

      // Should not throw, just log warning
      await expect(service.cleanDatabase()).resolves.not.toThrow();
    });
  });

  describe("the DB lane (docs/plans/db-lane.md)", () => {
    const prismaHistogram = (sumMs: number) => ({
      buckets: [
        [0, 0],
        [1, 2],
        [5, 1],
        [10, 0],
      ],
      sum: sumMs,
      count: 3,
    });

    it("turns Prisma's ms, per-bucket histogram into seconds, cumulative", () => {
      expect(toLaneHistogram(prismaHistogram(3.5) as never)).toEqual({
        buckets: [
          [0, 0],
          [0.001, 2],
          [0.005, 3],
          [0.01, 3],
        ],
        sum: 0.0035,
        count: 3,
      });
    });

    it("reads wait, query and total from $metrics", async () => {
      mockMetricsJson.mockResolvedValue({
        histograms: [
          {
            key: "prisma_client_queries_wait_histogram_ms",
            value: prismaHistogram(1),
          },
          {
            key: "prisma_datasource_queries_duration_histogram_ms",
            value: prismaHistogram(2),
          },
          {
            key: "prisma_client_queries_duration_histogram_ms",
            value: prismaHistogram(3),
          },
        ],
      });
      const lane = await service.getLaneHistograms();
      expect([lane?.wait.sum, lane?.query.sum, lane?.total.sum]).toEqual([
        0.001, 0.002, 0.003,
      ]);
    });

    it("is null when a histogram is missing or metrics fail", async () => {
      mockMetricsJson.mockResolvedValue({ histograms: [] });
      await expect(service.getLaneHistograms()).resolves.toBeNull();
      mockMetricsJson.mockRejectedValue(new Error("no metrics"));
      await expect(service.getLaneHistograms()).resolves.toBeNull();
    });

    it.each([
      [
        'SELECT "public"."propositions"."id" FROM "public"."propositions" WHERE 1',
        "propositions",
        "SELECT",
      ],
      [
        'INSERT INTO "public"."source_versions" ("id") VALUES ($1)',
        "source_versions",
        "INSERT",
      ],
      ['UPDATE "public"."propositions" SET "a" = $1', "propositions", "UPDATE"],
      ['DELETE FROM "public"."claims" WHERE "id" = $1', "claims", "DELETE"],
      ["BEGIN", "none", "BEGIN"],
      ["WITH x AS (SELECT 1) SELECT * FROM x", "none", "OTHER"],
    ])("labels %p as table %p, statement %p", (sql, table, statement) => {
      expect(statementLabels(sql)).toEqual({ table, statement });
    });

    it("counts each statement's engine time once, by table", () => {
      const increment = jest.fn();
      new DbService({ increment, observe: jest.fn() });
      const [event, onQuery] = mockOn.mock.calls.at(-1);
      expect(event).toBe("query");

      // A batched transaction emits one event per statement, each with its
      // own duration — not the batch's.
      onQuery({
        query: 'INSERT INTO "public"."propositions" ("id") VALUES ($1)',
        duration: 2,
      });
      onQuery({
        query: 'INSERT INTO "public"."propositions" ("id") VALUES ($1)',
        duration: 3,
      });

      expect(increment.mock.calls).toEqual([
        [
          "db_lane_busy_seconds_total",
          0.002,
          { table: "propositions", statement: "INSERT" },
        ],
        [
          "db_lane_busy_seconds_total",
          0.003,
          { table: "propositions", statement: "INSERT" },
        ],
      ]);
    });

    it("never lets a metric failure surface", () => {
      new DbService({
        increment: () => {
          throw new Error("registry gone");
        },
        observe: jest.fn(),
      });
      const [, onQuery] = mockOn.mock.calls.at(-1);
      expect(() => onQuery({ query: "SELECT 1", duration: 1 })).not.toThrow();
    });

    it("listens to nothing without an observer (the eval harness's new DbService())", () => {
      mockOn.mockClear();
      new DbService();
      expect(mockOn).not.toHaveBeenCalled();
    });

    it("reports the pool size it is bounded by, and when it is a guess", () => {
      process.env.PRISMA_CONNECTION_LIMIT = "7";
      expect(DbService.poolSize()).toEqual({ size: 7, estimated: false });
      delete process.env.PRISMA_CONNECTION_LIMIT;

      process.env.DATABASE_URL =
        "postgresql://u:p@db:5432/x?connection_limit=9";
      expect(DbService.poolSize()).toEqual({ size: 9, estimated: false });

      process.env.DATABASE_URL = "postgresql://u:p@db:5432/x";
      expect(DbService.poolSize()).toMatchObject({ estimated: true });
    });

    it("listens to no query event when DB_LANE_STATEMENT_METRICS=false", () => {
      process.env.DB_LANE_STATEMENT_METRICS = "false";
      mockOn.mockClear();
      new DbService({ increment: jest.fn(), observe: jest.fn() });
      expect(mockOn).not.toHaveBeenCalled();
      delete process.env.DB_LANE_STATEMENT_METRICS;
    });
  });
});

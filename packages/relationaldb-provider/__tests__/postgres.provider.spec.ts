import "reflect-metadata";
import {
  PostgresProvider,
  PostgresConfig,
  PoolConfig,
  DEFAULT_POOL_CONFIG,
} from "../src/providers/postgres.provider";
import { RelationalDBType } from "@qckstrt/common";
import { DEFAULT_CONNECTION_RETRY_CONFIG } from "../src/types";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("PostgresProvider", () => {
  let provider: PostgresProvider;
  const config: PostgresConfig = {
    host: "localhost",
    port: 5432,
    database: "testdb",
    username: "testuser",
    password: "testpass",
    ssl: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PostgresProvider(config);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider.getName()).toBe("PostgreSQL");
      expect(provider.getType()).toBe(RelationalDBType.PostgreSQL);
    });
  });

  describe("getName", () => {
    it("should return PostgreSQL", () => {
      expect(provider.getName()).toBe("PostgreSQL");
    });
  });

  describe("getType", () => {
    it("should return PostgreSQL type", () => {
      expect(provider.getType()).toBe(RelationalDBType.PostgreSQL);
    });
  });

  describe("getConnectionOptions", () => {
    it("should return correct connection options", () => {
      const entities = ["Entity1", "Entity2"];
      const options = provider.getConnectionOptions(entities) as any;

      expect(options.type).toBe("postgres");
      expect(options.host).toBe("localhost");
      expect(options.port).toBe(5432);
      expect(options.database).toBe("testdb");
      expect(options.username).toBe("testuser");
      expect(options.password).toBe("testpass");
      expect(options.entities).toEqual(entities);
      expect(options.synchronize).toBe(true);
      expect(options.logging).toBe(false);
    });

    it("should configure SSL when enabled", () => {
      const sslConfig: PostgresConfig = { ...config, ssl: true };
      const sslProvider = new PostgresProvider(sslConfig);
      const options = sslProvider.getConnectionOptions([]) as any;

      expect(options.ssl).toEqual({ rejectUnauthorized: false });
    });

    it("should disable SSL when not configured", () => {
      const options = provider.getConnectionOptions([]) as any;

      expect(options.ssl).toBe(false);
    });
  });

  describe("isAvailable", () => {
    it("should return true", async () => {
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });
  });

  describe("connection pool configuration", () => {
    it("should use default pool config when not provided", () => {
      const options = provider.getConnectionOptions([]) as any;

      expect(options.extra).toBeDefined();
      expect(options.extra.max).toBe(DEFAULT_POOL_CONFIG.max);
      expect(options.extra.min).toBe(DEFAULT_POOL_CONFIG.min);
      expect(options.extra.idleTimeoutMillis).toBe(
        DEFAULT_POOL_CONFIG.idleTimeoutMs,
      );
      expect(options.extra.connectionTimeoutMillis).toBe(
        DEFAULT_POOL_CONFIG.connectionTimeoutMs,
      );
      expect(options.extra.acquireTimeoutMillis).toBe(
        DEFAULT_POOL_CONFIG.acquireTimeoutMs,
      );
    });

    it("should use custom pool config when provided", () => {
      const customPool: PoolConfig = {
        max: 50,
        min: 10,
        idleTimeoutMs: 60000,
        connectionTimeoutMs: 10000,
        acquireTimeoutMs: 20000,
      };
      const customConfig: PostgresConfig = { ...config, pool: customPool };
      const customProvider = new PostgresProvider(customConfig);
      const options = customProvider.getConnectionOptions([]) as any;

      expect(options.extra.max).toBe(50);
      expect(options.extra.min).toBe(10);
      expect(options.extra.idleTimeoutMillis).toBe(60000);
      expect(options.extra.connectionTimeoutMillis).toBe(10000);
      expect(options.extra.acquireTimeoutMillis).toBe(20000);
    });

    it("should merge partial pool config with defaults", () => {
      const partialPool: PoolConfig = {
        max: 30,
      };
      const partialConfig: PostgresConfig = { ...config, pool: partialPool };
      const partialProvider = new PostgresProvider(partialConfig);
      const options = partialProvider.getConnectionOptions([]) as any;

      // Custom value
      expect(options.extra.max).toBe(30);
      // Default values
      expect(options.extra.min).toBe(DEFAULT_POOL_CONFIG.min);
      expect(options.extra.idleTimeoutMillis).toBe(
        DEFAULT_POOL_CONFIG.idleTimeoutMs,
      );
    });

    it("should return pool config via getPoolConfig", () => {
      const poolConfig = provider.getPoolConfig();

      expect(poolConfig).toEqual(DEFAULT_POOL_CONFIG);
    });

    it("getPoolConfig should return a copy not the original", () => {
      const poolConfig1 = provider.getPoolConfig();
      const poolConfig2 = provider.getPoolConfig();

      expect(poolConfig1).not.toBe(poolConfig2);
      expect(poolConfig1).toEqual(poolConfig2);
    });
  });

  describe("DEFAULT_POOL_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_POOL_CONFIG.max).toBe(20);
      expect(DEFAULT_POOL_CONFIG.min).toBe(5);
      expect(DEFAULT_POOL_CONFIG.idleTimeoutMs).toBe(30000);
      expect(DEFAULT_POOL_CONFIG.connectionTimeoutMs).toBe(5000);
      expect(DEFAULT_POOL_CONFIG.acquireTimeoutMs).toBe(10000);
    });
  });

  describe("connection retry configuration", () => {
    it("should return default retry config when not provided", () => {
      const retryConfig = provider.getRetryConfig();

      expect(retryConfig).toEqual(DEFAULT_CONNECTION_RETRY_CONFIG);
    });

    it("should use custom retry config when provided", () => {
      const customRetry = {
        maxAttempts: 10,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        useJitter: false,
      };
      const customConfig: PostgresConfig = { ...config, retry: customRetry };
      const customProvider = new PostgresProvider(customConfig);
      const retryConfig = customProvider.getRetryConfig();

      expect(retryConfig.maxAttempts).toBe(10);
      expect(retryConfig.baseDelayMs).toBe(2000);
      expect(retryConfig.maxDelayMs).toBe(60000);
      expect(retryConfig.useJitter).toBe(false);
    });

    it("should merge partial retry config with defaults", () => {
      const partialRetry = {
        maxAttempts: 8,
      };
      const partialConfig: PostgresConfig = { ...config, retry: partialRetry };
      const partialProvider = new PostgresProvider(partialConfig);
      const retryConfig = partialProvider.getRetryConfig();

      // Custom value
      expect(retryConfig.maxAttempts).toBe(8);
      // Default values
      expect(retryConfig.baseDelayMs).toBe(
        DEFAULT_CONNECTION_RETRY_CONFIG.baseDelayMs,
      );
      expect(retryConfig.maxDelayMs).toBe(
        DEFAULT_CONNECTION_RETRY_CONFIG.maxDelayMs,
      );
      expect(retryConfig.useJitter).toBe(
        DEFAULT_CONNECTION_RETRY_CONFIG.useJitter,
      );
    });
  });
});

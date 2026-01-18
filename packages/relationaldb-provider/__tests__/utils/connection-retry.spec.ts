import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  calculateBackoffDelay,
  isRetryableConnectionError,
  connectWithRetry,
  ConnectionRetryOptions,
} from "../../src/utils/connection-retry";
import {
  ConnectionRetryConfig,
  ConnectionRetryExhaustedError,
  DEFAULT_CONNECTION_RETRY_CONFIG,
} from "../../src/types";

// Mock NestJS Logger
const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => mockLogger),
}));

// Mock crypto randomInt to be deterministic in tests
jest.mock("node:crypto", () => ({
  randomInt: jest.fn((min: number, max: number) => min), // Always return min for deterministic tests
}));

describe("connection-retry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateBackoffDelay", () => {
    const baseConfig: ConnectionRetryConfig = {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      useJitter: false,
    };

    it("should calculate exponential delay for attempt 1", () => {
      const delay = calculateBackoffDelay(1, baseConfig);
      // baseDelay * 2^(1-1) = 1000 * 1 = 1000
      expect(delay).toBe(1000);
    });

    it("should calculate exponential delay for attempt 2", () => {
      const delay = calculateBackoffDelay(2, baseConfig);
      // baseDelay * 2^(2-1) = 1000 * 2 = 2000
      expect(delay).toBe(2000);
    });

    it("should calculate exponential delay for attempt 3", () => {
      const delay = calculateBackoffDelay(3, baseConfig);
      // baseDelay * 2^(3-1) = 1000 * 4 = 4000
      expect(delay).toBe(4000);
    });

    it("should calculate exponential delay for attempt 4", () => {
      const delay = calculateBackoffDelay(4, baseConfig);
      // baseDelay * 2^(4-1) = 1000 * 8 = 8000
      expect(delay).toBe(8000);
    });

    it("should calculate exponential delay for attempt 5", () => {
      const delay = calculateBackoffDelay(5, baseConfig);
      // baseDelay * 2^(5-1) = 1000 * 16 = 16000
      expect(delay).toBe(16000);
    });

    it("should cap delay at maxDelayMs", () => {
      const configWithLowMax: ConnectionRetryConfig = {
        ...baseConfig,
        maxDelayMs: 5000,
      };
      // Attempt 4 would be 8000ms but should be capped at 5000
      const delay = calculateBackoffDelay(4, configWithLowMax);
      expect(delay).toBe(5000);
    });

    it("should add jitter when useJitter is true", () => {
      const configWithJitter: ConnectionRetryConfig = {
        ...baseConfig,
        useJitter: true,
      };

      // Mock randomInt is returning min value (0), so delay should be same as without jitter
      const delay = calculateBackoffDelay(1, configWithJitter);
      expect(delay).toBe(1000);

      // Verify randomInt was called with correct range (0 to 25% of cappedDelay)
      const { randomInt } = require("node:crypto");
      expect(randomInt).toHaveBeenCalledWith(0, 251); // 25% of 1000 = 250, +1 for exclusive upper bound
    });

    it("should handle different base delay", () => {
      const customConfig: ConnectionRetryConfig = {
        ...baseConfig,
        baseDelayMs: 500,
      };
      const delay = calculateBackoffDelay(3, customConfig);
      // 500 * 2^2 = 2000
      expect(delay).toBe(2000);
    });
  });

  describe("isRetryableConnectionError", () => {
    it("should return true for ECONNREFUSED", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for ECONNRESET", () => {
      const error = new Error("read ECONNRESET");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for ETIMEDOUT", () => {
      const error = new Error("connect ETIMEDOUT 10.0.0.1:5432");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for ENOTFOUND", () => {
      const error = new Error("getaddrinfo ENOTFOUND db.example.com");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for EHOSTUNREACH", () => {
      const error = new Error("connect EHOSTUNREACH 192.168.1.100:5432");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for ENETUNREACH", () => {
      const error = new Error("connect ENETUNREACH 10.0.0.1:5432");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for connection refused", () => {
      const error = new Error("Connection refused by server");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for connection terminated", () => {
      const error = new Error("Connection terminated unexpectedly");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for connection reset", () => {
      const error = new Error("Connection reset by peer");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for socket hang up", () => {
      const error = new Error("socket hang up");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for too many connections", () => {
      const error = new Error(
        "FATAL: too many connections for role 'postgres'",
      );
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for server closed connection", () => {
      const error = new Error("server closed the connection unexpectedly");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for database starting up", () => {
      const error = new Error("the database system is starting up");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return true for database shutting down", () => {
      const error = new Error("the database system is shutting down");
      expect(isRetryableConnectionError(error)).toBe(true);
    });

    it("should return false for authentication errors", () => {
      const error = new Error('password authentication failed for user "test"');
      expect(isRetryableConnectionError(error)).toBe(false);
    });

    it("should return false for missing database errors", () => {
      const error = new Error('database "nonexistent" does not exist');
      expect(isRetryableConnectionError(error)).toBe(false);
    });

    it("should return false for permission errors", () => {
      const error = new Error("permission denied for schema public");
      expect(isRetryableConnectionError(error)).toBe(false);
    });

    it("should return false for syntax errors", () => {
      const error = new Error("syntax error at or near SELECT");
      expect(isRetryableConnectionError(error)).toBe(false);
    });

    it("should be case insensitive", () => {
      const error = new Error("SOCKET HANG UP");
      expect(isRetryableConnectionError(error)).toBe(true);
    });
  });

  describe("connectWithRetry", () => {
    let mockDataSource: jest.Mocked<DataSource>;

    beforeEach(() => {
      mockDataSource = {
        initialize: jest.fn(),
        options: {
          type: "postgres",
          host: "localhost",
        },
      } as any;
    });

    it("should succeed on first attempt", async () => {
      mockDataSource.initialize.mockResolvedValueOnce(mockDataSource);

      const result = await connectWithRetry(mockDataSource, {
        logger: mockLogger as any,
      });

      expect(result).toBe(mockDataSource);
      expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Database connection attempt 1/5"),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Database connection established successfully"),
      );
    });

    it("should retry on retryable error and succeed", async () => {
      const retryableError = new Error("connect ECONNREFUSED 127.0.0.1:5432");

      mockDataSource.initialize
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(mockDataSource);

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 3,
          baseDelayMs: 10, // Short delay for tests
          maxDelayMs: 100,
          useJitter: false,
        },
        logger: mockLogger as any,
      };

      const result = await connectWithRetry(mockDataSource, options);

      expect(result).toBe(mockDataSource);
      expect(mockDataSource.initialize).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Database connection attempt 1/3 failed"),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("after 2 attempt(s)"),
      );
    });

    it("should throw ConnectionRetryExhaustedError after all attempts fail", async () => {
      const retryableError = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      mockDataSource.initialize.mockRejectedValue(retryableError);

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 3,
          baseDelayMs: 1, // Very short delay for tests
          maxDelayMs: 10,
          useJitter: false,
        },
        logger: mockLogger as any,
      };

      await expect(connectWithRetry(mockDataSource, options)).rejects.toThrow(
        ConnectionRetryExhaustedError,
      );

      expect(mockDataSource.initialize).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Database connection failed after 3 attempts"),
      );
    });

    it("should not retry non-retryable errors", async () => {
      const nonRetryableError = new Error(
        'password authentication failed for user "test"',
      );
      mockDataSource.initialize.mockRejectedValue(nonRetryableError);

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 5,
          baseDelayMs: 10,
          maxDelayMs: 100,
          useJitter: false,
        },
        logger: mockLogger as any,
      };

      await expect(connectWithRetry(mockDataSource, options)).rejects.toThrow(
        ConnectionRetryExhaustedError,
      );

      // Should only try once since error is not retryable
      expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Non-retryable database error"),
      );
    });

    it("should call onRetry callback before each retry", async () => {
      const retryableError = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      const onRetry = jest.fn();

      mockDataSource.initialize
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(mockDataSource);

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 10,
          useJitter: false,
        },
        logger: mockLogger as any,
        onRetry,
      };

      await connectWithRetry(mockDataSource, options);

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        retryableError,
        1,
        expect.any(Number),
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        retryableError,
        2,
        expect.any(Number),
      );
    });

    it("should use default config when not provided", async () => {
      mockDataSource.initialize.mockResolvedValueOnce(mockDataSource);

      await connectWithRetry(mockDataSource);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          `1/${DEFAULT_CONNECTION_RETRY_CONFIG.maxAttempts}`,
        ),
      );
    });

    it("should handle non-Error objects thrown during initialization", async () => {
      mockDataSource.initialize.mockRejectedValue("string error");

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 1,
          baseDelayMs: 1,
          maxDelayMs: 10,
          useJitter: false,
        },
        logger: mockLogger as any,
      };

      await expect(connectWithRetry(mockDataSource, options)).rejects.toThrow(
        ConnectionRetryExhaustedError,
      );
    });

    it("should include correct attempt and duration in ConnectionRetryExhaustedError", async () => {
      const retryableError = new Error("connect ECONNREFUSED");
      mockDataSource.initialize.mockRejectedValue(retryableError);

      const options: ConnectionRetryOptions = {
        config: {
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 10,
          useJitter: false,
        },
        logger: mockLogger as any,
      };

      try {
        await connectWithRetry(mockDataSource, options);
        fail("Expected to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectionRetryExhaustedError);
        const exhaustedError = error as ConnectionRetryExhaustedError;
        expect(exhaustedError.attempts).toBe(2);
        expect(exhaustedError.lastError).toBe(retryableError);
        expect(exhaustedError.totalDurationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should handle unknown host in DataSource options", async () => {
      // Create a separate mock with different options type
      const mysqlDataSource = {
        initialize: jest.fn().mockResolvedValueOnce(undefined),
        options: { type: "mysql" }, // Different type without host
      } as any;

      const result = await connectWithRetry(mysqlDataSource, {
        logger: mockLogger as any,
      });

      expect(result).toBe(mysqlDataSource);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("to unknown"),
      );
    });
  });

  describe("ConnectionRetryExhaustedError", () => {
    it("should have correct properties", () => {
      const lastError = new Error("Connection failed");
      const error = new ConnectionRetryExhaustedError(5, lastError, 30000);

      expect(error.name).toBe("ConnectionRetryExhaustedError");
      expect(error.attempts).toBe(5);
      expect(error.lastError).toBe(lastError);
      expect(error.totalDurationMs).toBe(30000);
      expect(error.message).toContain("5 attempts");
      expect(error.message).toContain("30000ms");
      expect(error.message).toContain("Connection failed");
    });

    it("should extend Error", () => {
      const error = new ConnectionRetryExhaustedError(
        3,
        new Error("test"),
        1000,
      );
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("DEFAULT_CONNECTION_RETRY_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_CONNECTION_RETRY_CONFIG.maxAttempts).toBe(5);
      expect(DEFAULT_CONNECTION_RETRY_CONFIG.baseDelayMs).toBe(1000);
      expect(DEFAULT_CONNECTION_RETRY_CONFIG.maxDelayMs).toBe(30000);
      expect(DEFAULT_CONNECTION_RETRY_CONFIG.useJitter).toBe(true);
    });
  });
});

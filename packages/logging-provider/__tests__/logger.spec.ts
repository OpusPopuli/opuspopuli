import { createLogger, StructuredLogger } from "../src/logger";
import { LoggingError, LogLevel } from "../src/types";

describe("StructuredLogger", () => {
  let consoleSpy: {
    log: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, "log").mockImplementation(),
      warn: jest.spyOn(console, "warn").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with valid config", () => {
      const logger = createLogger({ serviceName: "test-service" });
      expect(logger).toBeInstanceOf(StructuredLogger);
    });

    it("should throw LoggingError when serviceName is missing", () => {
      expect(() => createLogger({ serviceName: "" })).toThrow(LoggingError);
      expect(() => createLogger({ serviceName: "" })).toThrow(
        "serviceName is required",
      );
    });

    it("should use default level INFO when not specified", () => {
      const logger = createLogger({ serviceName: "test-service" });
      logger.debug("debug message");
      logger.info("info message");

      // Debug should not be logged at INFO level
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    });

    it("should use JSON format in production", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const logger = createLogger({ serviceName: "test-service" });
      logger.info("test message");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();

      process.env.NODE_ENV = originalEnv;
    });

    it("should use pretty format in development", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const logger = createLogger({ serviceName: "test-service" });
      logger.info("test message");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("[INFO]");
      expect(output).toContain("test message");

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("log levels", () => {
    it("should log debug messages when level is DEBUG", () => {
      const logger = createLogger({
        serviceName: "test-service",
        level: LogLevel.DEBUG,
        format: "json",
      });

      logger.debug("debug message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should not log debug messages when level is INFO", () => {
      const logger = createLogger({
        serviceName: "test-service",
        level: LogLevel.INFO,
        format: "json",
      });

      logger.debug("debug message");
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it("should log info messages", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("info message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log using log() alias", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.log("log message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log warn messages", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.warn("warn message");
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it("should log error messages", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.error("error message");
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it("should filter logs based on minimum level", () => {
      const logger = createLogger({
        serviceName: "test-service",
        level: LogLevel.WARN,
        format: "json",
      });

      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("JSON output format", () => {
    it("should output valid JSON with required fields", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("test message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("timestamp");
      expect(output).toHaveProperty("level", "info");
      expect(output).toHaveProperty("service", "test-service");
      expect(output).toHaveProperty("message", "test message");
    });

    it("should include context when provided", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("test message", "MyContext");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("context", "MyContext");
    });

    it("should include metadata when provided", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("test message", "Context", { userId: "123", action: "test" });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.meta).toEqual({ userId: "123", action: "test" });
    });

    it("should include requestId when set", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.setRequestId("req-123");
      logger.info("test message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("requestId", "req-123");
    });

    it("should include userId when set", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.setUserId("user-456");
      logger.info("test message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("userId", "user-456");
    });

    it("should include error details", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        stackTrace: true,
      });

      const stack = "Error: test\n    at test.js:1:1";
      logger.error("error occurred", stack, "ErrorContext");

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.error).toBeDefined();
      expect(output.error.stack).toBe(stack);
    });

    it("should not include stack trace when disabled", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        stackTrace: false,
      });

      const stack = "Error: test\n    at test.js:1:1";
      logger.error("error occurred", stack, "ErrorContext");

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.error?.stack).toBeUndefined();
    });
  });

  describe("pretty output format", () => {
    it("should output colored formatted logs", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "pretty",
      });

      logger.info("test message");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("[INFO]");
      expect(output).toContain("test message");
    });

    it("should include timestamp when enabled", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "pretty",
        timestamp: true,
      });

      logger.info("test message");

      const output = consoleSpy.log.mock.calls[0][0];
      // Check for ISO timestamp pattern
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should include context in pretty output", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "pretty",
      });

      logger.info("test message", "MyContext");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("[MyContext]");
    });

    it("should include requestId in pretty output", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "pretty",
      });

      logger.setRequestId("req-123");
      logger.info("test message");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("(req-123)");
    });
  });

  describe("child logger", () => {
    it("should create child logger with context", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      const childLogger = logger.child("ChildContext");
      childLogger.info("child message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("context", "ChildContext");
    });

    it("should inherit requestId from parent", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.setRequestId("req-123");
      const childLogger = logger.child("ChildContext");
      childLogger.info("child message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("requestId", "req-123");
    });

    it("should inherit userId from parent", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.setUserId("user-456");
      const childLogger = logger.child("ChildContext");
      childLogger.info("child message");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output).toHaveProperty("userId", "user-456");
    });
  });

  describe("NestJS LoggerService interface", () => {
    it("should implement verbose as debug", () => {
      const logger = createLogger({
        serviceName: "test-service",
        level: LogLevel.DEBUG,
        format: "json",
      });

      logger.verbose("verbose message", "Context");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.level).toBe("debug");
    });

    it("should implement fatal as error", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.fatal("fatal message", "Context");

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.level).toBe("error");
    });
  });

  describe("durationMs extraction", () => {
    it("should extract durationMs to top-level field", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("request completed", undefined, { durationMs: 150, path: "/api" });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.durationMs).toBe(150);
      expect(output.meta).toEqual({ path: "/api" });
    });

    it("should not include durationMs in meta after extraction", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("request completed", undefined, { durationMs: 100 });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.durationMs).toBe(100);
      expect(output.meta).toBeUndefined();
    });

    it("should only extract numeric durationMs values", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
      });

      logger.info("request completed", undefined, { durationMs: "invalid", other: "value" });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.durationMs).toBeUndefined();
      // Non-numeric durationMs is stripped from meta, only other fields remain
      expect(output.meta).toEqual({ other: "value" });
    });
  });

  describe("PII redaction", () => {
    it("should redact email addresses when redactPii is enabled", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("User logged in: user@example.com");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("User logged in: [EMAIL_REDACTED]");
      expect(output.message).not.toContain("user@example.com");
    });

    it("should redact IPv4 addresses", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Request from 192.168.1.100");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("Request from [IP_REDACTED]");
    });

    it("should redact credit card numbers", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Card: 4111-1111-1111-1111");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("Card: [CC_REDACTED]");
    });

    it("should redact phone numbers", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Contact: (555) 123-4567");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("Contact: [PHONE_REDACTED]");
    });

    it("should redact JWT tokens", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("Token: [JWT_REDACTED]");
    });

    it("should redact Bearer tokens", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Authorization: Bearer abc123xyz");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("Authorization: Bearer [TOKEN_REDACTED]");
    });

    it("should redact PII in metadata", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Request received", undefined, {
        email: "user@example.com",
        ip: "10.0.0.1",
      });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.meta.email).toBe("[EMAIL_REDACTED]");
      expect(output.meta.ip).toBe("[IP_REDACTED]");
    });

    it("should redact PII in nested metadata", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
      });

      logger.info("Request received", undefined, {
        user: { email: "test@test.com", name: "John" },
      });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.meta.user.email).toBe("[EMAIL_REDACTED]");
      expect(output.meta.user.name).toBe("John");
    });

    it("should not redact when redactPii is disabled", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: false,
      });

      logger.info("User logged in: user@example.com");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("User logged in: user@example.com");
    });

    it("should redact PII in error stack traces", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "json",
        redactPii: true,
        stackTrace: true,
      });

      const stack = "Error: Failed for user@example.com\n    at test.js:1:1";
      logger.error("error occurred", stack, "ErrorContext");

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.error.stack).toContain("[EMAIL_REDACTED]");
      expect(output.error.stack).not.toContain("user@example.com");
    });

    it("should redact PII in pretty format", () => {
      const logger = createLogger({
        serviceName: "test-service",
        format: "pretty",
        redactPii: true,
      });

      logger.info("User: user@example.com from 192.168.1.1");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("[EMAIL_REDACTED]");
      expect(output).toContain("[IP_REDACTED]");
      expect(output).not.toContain("user@example.com");
      expect(output).not.toContain("192.168.1.1");
    });

    it("should default to redactPii true in production", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const logger = createLogger({ serviceName: "test-service" });
      logger.info("User: user@example.com");

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.message).toBe("User: [EMAIL_REDACTED]");

      process.env.NODE_ENV = originalEnv;
    });

    it("should default to redactPii false in development", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const logger = createLogger({ serviceName: "test-service" });
      logger.info("User: user@example.com");

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain("user@example.com");

      process.env.NODE_ENV = originalEnv;
    });
  });
});

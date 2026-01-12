import { LoggerService } from "@nestjs/common";

import {
  ILogger,
  LogEntry,
  LoggingConfig,
  LoggingError,
  LogLevel,
} from "./types";

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/**
 * PII patterns to redact from log messages and metadata
 */
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses (with length limits to prevent ReDoS)
  {
    pattern: /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,10}\b/g,
    replacement: "[EMAIL_REDACTED]",
  },
  // IPv4 addresses
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP_REDACTED]",
  },
  // IPv6 addresses (simplified pattern)
  {
    pattern: /\b(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}\b/g,
    replacement: "[IP_REDACTED]",
  },
  // Credit card numbers (basic pattern)
  {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: "[CC_REDACTED]",
  },
  // SSN (US Social Security Number)
  {
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  // Phone numbers (various formats)
  {
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
  },
  // JWT tokens
  {
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    replacement: "[JWT_REDACTED]",
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+[\w-]+/gi,
    replacement: "Bearer [TOKEN_REDACTED]",
  },
];

/**
 * Structured logger implementation that outputs JSON for CloudWatch Logs
 * or pretty-printed logs for development.
 */
export class StructuredLogger implements ILogger, LoggerService {
  private readonly config: Required<LoggingConfig>;
  private requestId?: string;
  private userId?: string;
  private context?: string;

  constructor(config: LoggingConfig) {
    if (!config.serviceName) {
      throw new LoggingError("serviceName is required");
    }

    this.config = {
      serviceName: config.serviceName,
      level: config.level ?? LogLevel.INFO,
      format:
        config.format ??
        (process.env.NODE_ENV === "production" ? "json" : "pretty"),
      timestamp: config.timestamp ?? true,
      stackTrace: config.stackTrace ?? process.env.NODE_ENV !== "production",
      redactPii: config.redactPii ?? process.env.NODE_ENV === "production",
    };
  }

  /**
   * Set the request ID for tracing
   */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  /**
   * Set the user ID for authenticated requests
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): ILogger {
    const childLogger = new StructuredLogger(this.config);
    childLogger.context = context;
    childLogger.requestId = this.requestId;
    childLogger.userId = this.userId;
    return childLogger;
  }

  /**
   * Log at DEBUG level
   */
  debug(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.writeLog(LogLevel.DEBUG, message, context, meta);
  }

  /**
   * Log at INFO level (alias for log)
   */
  log(message: string, context?: string, meta?: Record<string, unknown>): void {
    this.writeLog(LogLevel.INFO, message, context, meta);
  }

  /**
   * Log at INFO level
   */
  info(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.writeLog(LogLevel.INFO, message, context, meta);
  }

  /**
   * Log at WARN level
   */
  warn(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    this.writeLog(LogLevel.WARN, message, context, meta);
  }

  /**
   * Log at ERROR level
   */
  error(
    message: string,
    trace?: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    const errorMeta = trace
      ? {
          ...meta,
          error: {
            name: "Error",
            message,
            stack: this.config.stackTrace ? trace : undefined,
          },
        }
      : meta;
    this.writeLog(LogLevel.ERROR, message, context, errorMeta);
  }

  /**
   * NestJS LoggerService interface method
   */
  verbose(message: string, context?: string): void {
    this.debug(message, context);
  }

  /**
   * NestJS LoggerService interface method
   */
  fatal(message: string, context?: string): void {
    this.error(message, undefined, context);
  }

  /**
   * Check if the log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Write a log entry
   */
  private writeLog(
    level: LogLevel,
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.createLogEntry(level, message, context, meta);

    if (this.config.format === "json") {
      this.writeJson(entry, level);
    } else {
      this.writePretty(entry, level);
    }
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.config.serviceName,
      message,
    };

    const effectiveContext = context ?? this.context;
    if (effectiveContext) {
      entry.context = effectiveContext;
    }

    if (this.requestId) {
      entry.requestId = this.requestId;
    }

    if (this.userId) {
      entry.userId = this.userId;
    }

    if (meta) {
      this.processMetadata(entry, meta);
    }

    return entry;
  }

  /**
   * Process metadata and extract special fields to top-level
   */
  private processMetadata(entry: LogEntry, meta: Record<string, unknown>): void {
    // Extract durationMs to top-level field for CloudWatch Logs Insights queries
    if ("durationMs" in meta && typeof meta.durationMs === "number") {
      entry.durationMs = meta.durationMs;
    }

    // Extract error to top-level and compute remaining meta
    const hasError = "error" in meta && typeof meta.error === "object";
    if (hasError) {
      entry.error = meta.error as LogEntry["error"];
    }

    // Remove extracted fields from meta
    const { error: _error, durationMs: _duration, ...restMeta } = meta;
    if (Object.keys(restMeta).length > 0) {
      entry.meta = restMeta;
    }
  }

  /**
   * Redact PII from a string value
   */
  private redactString(value: string): string {
    if (!this.config.redactPii) {
      return value;
    }
    let result = value;
    for (const { pattern, replacement } of PII_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Recursively redact PII from an object
   */
  private redactObject<T>(obj: T): T {
    if (!this.config.redactPii || obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      return this.redactString(obj) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as T;
    }

    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.redactObject(value);
      }
      return result as T;
    }

    return obj;
  }

  /**
   * Apply PII redaction to a log entry
   */
  private redactEntry(entry: LogEntry): LogEntry {
    if (!this.config.redactPii) {
      return entry;
    }

    return {
      ...entry,
      message: this.redactString(entry.message),
      meta: entry.meta ? this.redactObject(entry.meta) : undefined,
      error: entry.error
        ? {
            ...entry.error,
            message: this.redactString(entry.error.message),
            stack: entry.error.stack
              ? this.redactString(entry.error.stack)
              : undefined,
          }
        : undefined,
    };
  }

  /**
   * Write JSON formatted log (for CloudWatch)
   */
  private writeJson(entry: LogEntry, level: LogLevel): void {
    const redactedEntry = this.redactEntry(entry);
    const output = JSON.stringify(redactedEntry);

    if (level === LogLevel.ERROR) {
      console.error(output);
    } else if (level === LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Write pretty-printed log (for development)
   */
  private writePretty(entry: LogEntry, level: LogLevel): void {
    const redactedEntry = this.redactEntry(entry);
    const colors = {
      [LogLevel.DEBUG]: "\x1b[36m", // Cyan
      [LogLevel.INFO]: "\x1b[32m", // Green
      [LogLevel.WARN]: "\x1b[33m", // Yellow
      [LogLevel.ERROR]: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const dim = "\x1b[2m";

    const timestamp = this.config.timestamp
      ? `${dim}${redactedEntry.timestamp}${reset} `
      : "";
    const levelStr = `${colors[level]}[${level.toUpperCase()}]${reset}`;
    const contextStr = redactedEntry.context
      ? ` ${dim}[${redactedEntry.context}]${reset}`
      : "";
    const requestStr = redactedEntry.requestId
      ? ` ${dim}(${redactedEntry.requestId})${reset}`
      : "";

    let output = `${timestamp}${levelStr}${contextStr}${requestStr} ${redactedEntry.message}`;

    if (redactedEntry.meta && Object.keys(redactedEntry.meta).length > 0) {
      output += ` ${dim}${JSON.stringify(redactedEntry.meta)}${reset}`;
    }

    if (redactedEntry.error?.stack) {
      output += `\n${dim}${redactedEntry.error.stack}${reset}`;
    }

    if (level === LogLevel.ERROR) {
      console.error(output);
    } else if (level === LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * Create a logger instance with the given configuration
 */
export function createLogger(config: LoggingConfig): StructuredLogger {
  return new StructuredLogger(config);
}

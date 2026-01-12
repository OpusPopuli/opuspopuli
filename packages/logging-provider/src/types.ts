/**
 * Log levels supported by the logger
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * Configuration for the logging provider
 */
export interface LoggingConfig {
  /** Service name to include in all log entries */
  serviceName: string;
  /** Minimum log level to output */
  level?: LogLevel;
  /** Output format: 'json' for CloudWatch, 'pretty' for development */
  format?: "json" | "pretty";
  /** Include timestamp in logs (default: true) */
  timestamp?: boolean;
  /** Include stack traces for errors (default: true in development) */
  stackTrace?: boolean;
  /** Redact PII from log messages and metadata (default: true in production) */
  redactPii?: boolean;
}

/**
 * Structured log entry format for CloudWatch Logs
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Service name */
  service: string;
  /** Log message */
  message: string;
  /** Optional context/logger name */
  context?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** User ID if authenticated */
  userId?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
  /** Error details if present */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  /** Duration in milliseconds for performance tracking */
  durationMs?: number;
}

/**
 * Interface for the logger service
 */
export interface ILogger {
  debug(
    message: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void;
  log(message: string, context?: string, meta?: Record<string, unknown>): void;
  info(message: string, context?: string, meta?: Record<string, unknown>): void;
  warn(message: string, context?: string, meta?: Record<string, unknown>): void;
  error(
    message: string,
    trace?: string,
    context?: string,
    meta?: Record<string, unknown>,
  ): void;
  setRequestId(requestId: string): void;
  setUserId(userId: string): void;
  child(context: string): ILogger;
}

/**
 * Error class for logging-related errors
 */
export class LoggingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoggingError";
  }
}

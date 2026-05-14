// Re-export the canonical types from @opuspopuli/common to avoid
// maintaining duplicate definitions (#7 jscpd clone fix).
// LogLevel is identical; ILoggingProvider is aliased as ILogger for
// backward-compatibility with code that imports from this package.
export { LogLevel, ILoggingProvider as ILogger } from "@opuspopuli/common";
import type { LogLevel, ILoggingProvider as ILogger } from "@opuspopuli/common";

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
  /** OpenTelemetry trace ID for distributed tracing */
  traceId?: string;
  /** OpenTelemetry span ID for distributed tracing */
  spanId?: string;
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
 * Error class for logging-related errors
 */
export class LoggingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoggingError";
  }
}

import { Logger, LoggerService } from '@nestjs/common';
import { redactPiiFromString, sanitizeForLogging } from '../utils/pii-masker';

/**
 * SecureLogger - A wrapper around NestJS Logger that automatically redacts PII.
 *
 * This logger intercepts all log calls and applies PII redaction to messages
 * and context data before logging. Use this instead of the standard Logger
 * in services that handle sensitive user data.
 *
 * Features:
 * - Redacts emails (partial: j***n@example.com)
 * - Redacts phone numbers (partial: ***-***-1234)
 * - Redacts SSN (full: [REDACTED_SSN])
 * - Redacts credit cards (full: [REDACTED_CC])
 * - Masks IP addresses (partial: 192.x.x.x)
 * - Sanitizes objects with sensitive field names
 *
 * @example
 * ```typescript
 * private readonly logger = new SecureLogger(MyService.name);
 *
 * // These will have PII automatically redacted:
 * this.logger.warn(`Login failed for: ${email}`);
 * this.logger.log(`User data: ${JSON.stringify(userData)}`);
 * ```
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
 */
export class SecureLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(context: string = 'Application') {
    this.logger = new Logger(context, { timestamp: true });
  }

  /**
   * Sanitizes a log message by redacting PII patterns.
   */
  private sanitizeMessage(message: unknown): string {
    if (typeof message === 'string') {
      return redactPiiFromString(message);
    }
    if (typeof message === 'object' && message !== null) {
      return JSON.stringify(sanitizeForLogging(message));
    }
    return String(message);
  }

  /**
   * Sanitizes optional parameters (context data, stack traces, etc.)
   */
  private sanitizeOptionalParams(...optionalParams: unknown[]): unknown[] {
    return optionalParams.map((param) => {
      if (typeof param === 'string') {
        return redactPiiFromString(param);
      }
      if (typeof param === 'object' && param !== null) {
        return sanitizeForLogging(param);
      }
      return param;
    });
  }

  /**
   * Log a message at 'log' level with PII redaction.
   */
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.log(
      this.sanitizeMessage(message),
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Log a message at 'error' level with PII redaction.
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(
      this.sanitizeMessage(message),
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Log a message at 'warn' level with PII redaction.
   */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(
      this.sanitizeMessage(message),
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Log a message at 'debug' level with PII redaction.
   */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(
      this.sanitizeMessage(message),
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Log a message at 'verbose' level with PII redaction.
   */
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.verbose(
      this.sanitizeMessage(message),
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Log a fatal error with PII redaction.
   */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    // NestJS Logger doesn't have fatal, use error instead
    this.logger.error(
      `[FATAL] ${this.sanitizeMessage(message)}`,
      ...this.sanitizeOptionalParams(...optionalParams),
    );
  }

  /**
   * Set the log context.
   */
  setContext(context: string): void {
    // Create a new logger with the updated context
    (this.logger as unknown as { context: string }).context = context;
  }
}

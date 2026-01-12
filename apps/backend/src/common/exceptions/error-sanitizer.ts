import { HttpStatus, Logger } from '@nestjs/common';
import { isProduction } from 'src/config/environment.config';

/**
 * Error Sanitization Utility
 *
 * Prevents information disclosure by sanitizing error messages in production.
 * Full error details are logged server-side for debugging.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */

const logger = new Logger('ErrorSanitizer');

/**
 * Generic error messages for production
 * Maps HTTP status codes to user-friendly messages
 */
export const GENERIC_ERROR_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Invalid request. Please check your input.',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required.',
  [HttpStatus.FORBIDDEN]: 'Access denied.',
  [HttpStatus.NOT_FOUND]: 'Resource not found.',
  [HttpStatus.CONFLICT]: 'A conflict occurred with the current state.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unable to process the request.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'An unexpected error occurred.',
  [HttpStatus.BAD_GATEWAY]: 'Service temporarily unavailable.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable.',
  [HttpStatus.GATEWAY_TIMEOUT]: 'Request timed out. Please try again.',
};

/**
 * Patterns that indicate sensitive information in error messages
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Database-related
  /column\s+["']?\w+["']?\s+(?:does not exist|of relation)/i,
  /relation\s+["']?\w+["']?\s+does not exist/i,
  /duplicate\s+key\s+value\s+violates\s+unique\s+constraint/i,
  /violates\s+(?:check|foreign\s+key|not-null)\s+constraint/i,
  /syntax\s+error\s+at\s+or\s+near/i,
  /invalid\s+input\s+syntax\s+for/i,
  /null\s+value\s+in\s+column/i,
  /Key\s+\([^)]+\)\s*=\s*\([^)]+\)\s+already\s+exists/i,
  /Key\s+\([^)]+\)\s*=\s*\([^)]+\)\s+is\s+not\s+present/i,
  // File system paths
  /(?:\/[\w.-]+){3,}/,
  /[A-Za-z]:\\(?:[\w.-]+\\){2,}/,
  // Stack traces
  /at\s+[\w$.]+\s+\([^)]+:\d+:\d+\)/,
  /at\s+[\w$./<>]+\s+\([^)]+\)/,
  // Internal module paths
  /node_modules/i,
  /dist\//,
  /src\//,
  // Database connection strings
  /postgres(?:ql)?:\/\/[^@\s]+@/i,
  /mongodb(?:\+srv)?:\/\/[^@\s]+@/i,
  /mysql:\/\/[^@\s]+@/i,
  // API keys and tokens
  /(?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+/i,
  // Internal IP addresses
  /(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}/,
  // Internal hostnames
  /localhost:\d+/i,
  /127\.0\.0\.1:\d+/,
];

/**
 * Safe messages that can be passed through even if they match patterns
 */
const SAFE_MESSAGE_PREFIXES: string[] = [
  'Invalid email',
  'Invalid password',
  'User not found',
  'Email already exists',
  'Invalid credentials',
  'Session expired',
  'Token expired',
  'Validation failed',
  'Too many requests',
  'Access denied',
  'Permission denied',
  'Not authorized',
];

/**
 * Check if a message contains sensitive information
 */
export function containsSensitiveInfo(message: string): boolean {
  if (!message) return false;

  // Check if it's a known safe message
  for (const prefix of SAFE_MESSAGE_PREFIXES) {
    if (message.toLowerCase().startsWith(prefix.toLowerCase())) {
      return false;
    }
  }

  // Check against sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize an error message for production
 * Returns a generic message if sensitive info is detected
 */
export function sanitizeErrorMessage(
  message: string,
  statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
): string {
  if (!isProduction()) {
    return message;
  }

  // For 5xx errors, always return generic message in production
  if (statusCode >= 500) {
    return (
      GENERIC_ERROR_MESSAGES[statusCode] ||
      GENERIC_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR]
    );
  }

  // Check if message contains sensitive info
  if (containsSensitiveInfo(message)) {
    logger.debug(`Sanitized sensitive error message: ${message}`);
    return (
      GENERIC_ERROR_MESSAGES[statusCode] ||
      GENERIC_ERROR_MESSAGES[HttpStatus.BAD_REQUEST]
    );
  }

  return message;
}

/**
 * Sanitize database error messages
 * These often contain schema details that shouldn't be exposed
 */
export function sanitizeDatabaseError(
  errorDetail: string | undefined,
  errorCode: string,
): string {
  if (!isProduction()) {
    return errorDetail || 'Database operation failed';
  }

  // Map database error codes to user-friendly messages
  const dbErrorMessages: Record<string, string> = {
    '23505': 'This record already exists.', // Unique violation
    '23503': 'This operation references a record that does not exist.', // Foreign key
    '23502': 'Required information is missing.', // Not null violation
    '23514': 'The provided data does not meet requirements.', // Check violation
    '42P01': 'An internal error occurred.', // Undefined table
    '42703': 'An internal error occurred.', // Undefined column
    '42601': 'An internal error occurred.', // Syntax error
  };

  return dbErrorMessages[errorCode] || 'A database error occurred.';
}

/**
 * Log full error details server-side for debugging
 */
export function logErrorDetails(
  context: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): void {
  const errorObj =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : { error };

  logger.error(`[${context}] ${JSON.stringify(errorObj)}`, {
    ...metadata,
    ...errorObj,
  });
}

/**
 * Create a sanitized error response object
 */
export interface SanitizedErrorResponse {
  statusCode: number;
  message: string;
  timestamp: string;
  path?: string;
  requestId?: string;
}

export function createSanitizedResponse(
  statusCode: number,
  originalMessage: string,
  path?: string,
  requestId?: string,
): SanitizedErrorResponse {
  return {
    statusCode,
    message: sanitizeErrorMessage(originalMessage, statusCode),
    timestamp: new Date().toISOString(),
    ...(path && { path }),
    ...(requestId && { requestId }),
  };
}

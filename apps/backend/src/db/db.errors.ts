import { Logger } from '@nestjs/common';
import { Prisma } from '@qckstrt/relationaldb-provider';
import { sanitizeDatabaseError } from '../common/exceptions/error-sanitizer';

const logger = new Logger('DbErrors');

export enum DbErrorCodes {
  UniqueConstraintViolation = 'P2002',
  ForeignKeyConstraintViolation = 'P2003',
  RecordNotFound = 'P2025',
  NullConstraintViolation = 'P2011',
  ValueTooLong = 'P2000',
}

export class DbError extends Error {
  public constructor(message = 'Unknown database error') {
    super(message);
  }
}

export class DbConfigError extends DbError {
  public constructor(message = 'Database configuration error') {
    super(message);
  }
}

/**
 * Handle known database request errors with sanitization
 *
 * Logs full error details server-side and returns sanitized messages
 * to prevent information disclosure about database schema.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */
const handleKnownRequestError = (
  error: Prisma.PrismaClientKnownRequestError,
): DbError => {
  // Log full error details server-side for debugging
  logger.error('Database query failed', {
    code: error.code,
    meta: error.meta,
    message: error.message,
  });

  // Map error codes to user-friendly messages
  let sanitizedMessage: string;

  switch (error.code) {
    case DbErrorCodes.UniqueConstraintViolation: {
      // Extract field name from meta if available
      const target = error.meta?.target;
      const fieldDetail =
        Array.isArray(target) && target.length > 0
          ? `(${target.join(', ')})`
          : '';
      sanitizedMessage = sanitizeDatabaseError(
        `Unique constraint violation ${fieldDetail}`,
        '23505', // PostgreSQL unique violation code
      );
      break;
    }
    case DbErrorCodes.ForeignKeyConstraintViolation:
      sanitizedMessage = sanitizeDatabaseError(
        'Foreign key constraint violation',
        '23503', // PostgreSQL FK violation code
      );
      break;
    case DbErrorCodes.RecordNotFound:
      sanitizedMessage = 'Record not found';
      break;
    case DbErrorCodes.NullConstraintViolation:
      sanitizedMessage = sanitizeDatabaseError(
        'Required field is missing',
        '23502', // PostgreSQL not-null violation code
      );
      break;
    case DbErrorCodes.ValueTooLong:
      sanitizedMessage = 'Value exceeds maximum length';
      break;
    default:
      sanitizedMessage = 'A database error occurred.';
  }

  return new DbError(sanitizedMessage);
};

/**
 * Evaluates database errors and returns appropriate DbError
 */
export function evaluateDbError(error: unknown): DbError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return handleKnownRequestError(error);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.error('Database validation error', {
      message: error.message,
    });
    return new DbError('Invalid data provided.');
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error('Database initialization error', {
      message: error.message,
    });
    return new DbConfigError('Database connection error.');
  }

  // Unknown error type
  logger.error('Unexpected database error', {
    error: error instanceof Error ? error.message : String(error),
  });
  return new DbError('A database error occurred.');
}

export default evaluateDbError;

import { Logger } from '@nestjs/common';
import { QueryFailedError, TypeORMError } from 'typeorm';
import { sanitizeDatabaseError } from '../common/exceptions/error-sanitizer';

const logger = new Logger('DbErrors');

export enum PostgresErrorCodes {
  UniqueViolation = '23505',
  CheckViolation = '23514',
  NotNullViolation = '23502',
  ForeignKeyViolation = '23503',
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

interface PostgresDriverError {
  code: string;
  detail?: string;
}

/**
 * Handle query failed errors with sanitization
 *
 * Logs full error details server-side and returns sanitized messages
 * to prevent information disclosure about database schema.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */
const handleQueryFailedError = (error: QueryFailedError): DbError => {
  const postgresDriverError =
    error.driverError as unknown as PostgresDriverError;

  // Log full error details server-side for debugging
  logger.error('Database query failed', {
    code: postgresDriverError.code,
    detail: postgresDriverError.detail,
    query: error.query,
  });

  // Return sanitized error message
  const sanitizedMessage = sanitizeDatabaseError(
    postgresDriverError.detail,
    postgresDriverError.code,
  );

  return new DbError(sanitizedMessage);
};

export default (error: TypeORMError): DbError => {
  switch (error.name) {
    case 'QueryFailedError':
      return handleQueryFailedError(error as QueryFailedError);
    default:
      // Log unexpected database errors
      logger.error('Unexpected database error', {
        name: error.name,
        message: error.message,
      });
      return new DbError('A database error occurred.');
  }
};

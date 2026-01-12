import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  createSanitizedResponse,
  logErrorDetails,
  GENERIC_ERROR_MESSAGES,
} from './error-sanitizer';
import { isProduction } from 'src/config/environment.config';

/**
 * Global Exception Filter
 *
 * Catches all unhandled exceptions and ensures:
 * - Full error details are logged server-side
 * - Sanitized error responses are returned to clients
 * - Stack traces are never exposed in production
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine HTTP status code
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extract original error message
    let originalMessage: string;
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      originalMessage =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (
              exceptionResponse as Record<string, unknown>
            ).message?.toString() || exception.message;
    } else if (exception instanceof Error) {
      originalMessage = exception.message;
    } else {
      originalMessage = 'Unknown error';
    }

    // Log full error details server-side
    logErrorDetails('AllExceptionsFilter', exception, {
      path: request.url,
      method: request.method,
      statusCode: status,
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });

    // Create sanitized response for client
    const sanitizedResponse = createSanitizedResponse(
      status,
      originalMessage,
      request.url,
      request.auditContext?.requestId,
    );

    // In production, for 5xx errors, always use generic message
    if (isProduction() && status >= 500) {
      sanitizedResponse.message =
        GENERIC_ERROR_MESSAGES[status] ||
        GENERIC_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR];
    }

    // Send sanitized response
    response.status(status).json(sanitizedResponse);
  }
}

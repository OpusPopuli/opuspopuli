import {
  ArgumentsHost,
  Catch,
  HttpException,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sanitizeErrorMessage, logErrorDetails } from './error-sanitizer';
// Import for Express Request augmentation (auditContext)
import '../types/express';

/**
 * HTTP Exception Filter
 *
 * Handles HTTP exceptions with error sanitization to prevent
 * information disclosure in production.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response: Response = ctx.getResponse<Response>();
    const request: Request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();

    // Extract original message
    const originalMessage =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as Record<string, unknown>).message?.toString() ||
          exception.message;

    // Log full error details server-side
    logErrorDetails('HttpExceptionFilter', exception, {
      path: request.url,
      method: request.method,
      statusCode: status,
    });

    // Sanitize message for client response
    const sanitizedMessage = sanitizeErrorMessage(originalMessage, status);

    response.status(status).json({
      code: status,
      timestamp: new Date().toISOString(),
      message: sanitizedMessage,
      path: request.url,
      ...(request.auditContext?.requestId && {
        requestId: request.auditContext.requestId,
      }),
    });
  }
}

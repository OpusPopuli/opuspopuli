import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlArgumentsHost } from '@nestjs/graphql';
import { redactUrl } from '../tracing-redaction';
import { Request, Response } from 'express';
import {
  createSanitizedResponse,
  logErrorDetails,
  GENERIC_ERROR_MESSAGES,
} from './error-sanitizer';
import { isProduction } from 'src/config/environment.config';
// Import for Express Request augmentation (auditContext)
import '../types/express';

/**
 * Global Exception Filter
 *
 * Catches all unhandled exceptions and ensures:
 * - Full error details are logged server-side
 * - Sanitized error responses are returned to clients
 * - Stack traces are never exposed in production
 *
 * Handles both HTTP and GraphQL contexts — in GraphQL context,
 * host.switchToHttp().getRequest() may return undefined when
 * exceptions originate from guards or interceptors.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/190
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // In GraphQL context, switchToHttp() returns undefined request/response.
    // Detect this and let the GraphQL error handler deal with it.
    const contextType = host.getType<string>();
    if (contextType === 'graphql') {
      const gqlHost = GqlArgumentsHost.create(host);
      const request = gqlHost.getContext()?.req;

      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

      logErrorDetails('AllExceptionsFilter', exception, {
        path: request?.url
          ? redactUrl(request.url)
          : (gqlHost.getInfo()?.fieldName ?? 'graphql'),
        method: request?.method ?? 'POST',
        statusCode: status,
        ip: request?.ip,
      });

      // Re-throw so the GraphQL error formatter handles the response
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine HTTP status code
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const originalMessage = this.extractMessage(exception);

    // Log full error details server-side. No user agent, and a path without
    // query values (#1460): both are the visitor's, and this logger has no
    // redaction of its own. `ip` is the socket peer (the tunnel or the
    // gateway), not the visitor.
    logErrorDetails('AllExceptionsFilter', exception, {
      path: request?.url ? redactUrl(request.url) : undefined,
      method: request?.method,
      statusCode: status,
      ip: request?.ip,
    });

    // Create sanitized response for client
    const sanitizedResponse = createSanitizedResponse(
      status,
      originalMessage,
      request?.url,
      request?.auditContext?.requestId,
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

  private extractMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      return typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as Record<string, unknown>).message?.toString() ||
            exception.message;
    }
    if (exception instanceof Error) {
      return exception.message;
    }
    return 'Unknown error';
  }
}

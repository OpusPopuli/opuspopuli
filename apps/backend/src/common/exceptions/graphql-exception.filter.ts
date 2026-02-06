import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlArgumentsHost } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import {
  sanitizeErrorMessage,
  logErrorDetails,
  GENERIC_ERROR_MESSAGES,
} from './error-sanitizer';
import { isProduction } from 'src/config/environment.config';

/**
 * GraphQL Exception Filter
 *
 * Handles GraphQL exceptions with error sanitization to prevent
 * information disclosure in production.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/190
 */
@Catch(GraphQLError)
export class GraphQLExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GraphQLExceptionFilter.name);

  catch(exception: GraphQLError, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host);
    const ctx = gqlHost.getContext();
    const request = ctx.req;

    // Extract status code from extensions
    const statusCode =
      typeof exception.extensions?.code === 'number'
        ? exception.extensions.code
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log full error details server-side
    logErrorDetails('GraphQLExceptionFilter', exception, {
      path: gqlHost.getInfo()?.fieldName,
      statusCode,
    });

    // Sanitize message for client response
    let sanitizedMessage: string;
    if (isProduction() && statusCode >= 500) {
      sanitizedMessage =
        GENERIC_ERROR_MESSAGES[statusCode] ||
        GENERIC_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR];
    } else {
      sanitizedMessage = sanitizeErrorMessage(exception.message, statusCode);
    }

    const errorReturn = new GraphQLError(sanitizedMessage, {
      extensions: {
        code: exception.extensions?.code || 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString(),
        path:
          gqlHost.getInfo()?.fieldName || request?.originalUrl || request?.url,
      },
    });

    // Return a formatted error response
    return errorReturn;
  }
}

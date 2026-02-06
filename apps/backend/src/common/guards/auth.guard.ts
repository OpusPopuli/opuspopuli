import {
  Injectable,
  ExecutionContext,
  CanActivate,
  Optional,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { isLoggedIn } from 'src/common/auth/jwt.strategy';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';

/**
 * Apollo Federation and GraphQL introspection field names.
 * These are allowed without user authentication when the request comes
 * from a trusted source (HMAC-authenticated API Gateway).
 *
 * - __schema, __type: Standard GraphQL introspection
 * - _service: Apollo Federation service discovery
 * - _entities: Apollo Federation entity resolution
 */
const FEDERATION_INTROSPECTION_FIELDS = new Set([
  '__schema',
  '__type',
  '_service',
  '_entities',
]);

/**
 * Global authentication guard for GraphQL operations.
 *
 * SECURITY: Implements "deny by default" - all operations require authentication
 * unless explicitly marked with @Public() decorator.
 *
 * This guard checks request.user which is populated by the AuthMiddleware
 * after JWT validation via Passport.js. It does NOT trust headers that
 * could be spoofed by clients.
 *
 * Federation/introspection queries are allowed from HMAC-authenticated
 * sources (API Gateway) to support Apollo Federation schema composition.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/183
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the endpoint is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext().req;
    const info = ctx.getInfo();

    // Allow federation/introspection queries from HMAC-authenticated sources
    // These are internal queries from the API Gateway for schema composition
    const fieldName = info?.fieldName;
    if (fieldName && FEDERATION_INTROSPECTION_FIELDS.has(fieldName)) {
      // Verify the request came through HMAC validation (from API Gateway)
      const hasHmacAuth = request?.headers?.['x-hmac-auth'];
      if (hasHmacAuth) {
        return true;
      }
    }

    // SECURITY: Only trust request.user which is set by AuthMiddleware
    // after JWT validation via Passport.js. Never trust request.headers.user
    // as it can be spoofed by clients.
    const user = request.user;

    // No authenticated user - deny access
    if (!user || !isLoggedIn(user)) {
      // Audit: Authorization denied - unauthenticated access attempt
      // @see https://github.com/OpusPopuli/opuspopuli/issues/191
      this.auditLogService?.logSync({
        requestId: randomUUID(),
        serviceName: 'auth-guard',
        action: AuditAction.AUTHORIZATION_DENIED,
        success: false,
        resolverName: info?.fieldName,
        operationType: info?.parentType?.name?.toLowerCase() as
          | 'query'
          | 'mutation'
          | 'subscription',
        ipAddress:
          request?.ip ||
          (request?.headers as Record<string, string>)?.['x-forwarded-for'],
        userAgent: request?.headers?.['user-agent'],
        errorMessage: 'Unauthenticated access attempt',
      });

      this.logger.warn(
        `Unauthenticated access attempt to ${info?.fieldName || 'unknown'} from IP: ${request?.ip || 'unknown'}`,
      );
      return false;
    }

    return true;
  }
}

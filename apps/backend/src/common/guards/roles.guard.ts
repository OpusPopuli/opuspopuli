import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

import { ILogin } from 'src/interfaces/login.interface';
import { isLoggedIn } from 'src/common/auth/jwt.strategy';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';

/**
 * Apollo Federation and GraphQL introspection field names.
 * These are allowed without user authentication when the request comes
 * from a trusted source (HMAC-authenticated API Gateway).
 */
const FEDERATION_INTROSPECTION_FIELDS = new Set([
  '__schema',
  '__type',
  '_service',
  '_entities',
]);

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext().req;
    const info = ctx.getInfo();

    // Allow federation/introspection queries from HMAC-authenticated sources
    // These are internal queries from the API Gateway for schema composition
    const fieldName = info?.fieldName;
    if (fieldName && FEDERATION_INTROSPECTION_FIELDS.has(fieldName)) {
      const hasHmacAuth = request?.headers?.['x-hmac-auth'];
      if (hasHmacAuth) {
        return true;
      }
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    // SECURITY: Use request.user set by AuthMiddleware after JWT validation
    // Never trust request.headers.user as it can be spoofed
    // @see https://github.com/OpusPopuli/opuspopuli/issues/183
    const user: ILogin | undefined = request.user;

    if (user && isLoggedIn(user)) {
      const hasRole = requiredRoles.some((role) => user.roles?.includes(role));

      if (!hasRole) {
        // Audit: Authorization denied - insufficient role
        // @see https://github.com/OpusPopuli/opuspopuli/issues/191
        this.auditLogService?.logSync({
          requestId: randomUUID(),
          serviceName: 'roles-guard',
          userId: user.id,
          userEmail: user.email,
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
          errorMessage: `Insufficient role. Required: ${requiredRoles.join(', ')}`,
          inputVariables: {
            requiredRoles,
            userRoles: user.roles,
          },
        });

        this.logger.warn(
          `Role-based access denied for user ${user.email} to ${info?.fieldName || 'unknown'}. Required: ${requiredRoles.join(', ')}`,
        );
      }

      return hasRole;
    }

    return false;
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';

import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

import { ILogin } from 'src/interfaces/login.interface';
import { isLoggedIn } from 'src/common/auth/jwt.strategy';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { auditAuthorizationDenied } from './guard-audit.helper';

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

    // SECURITY: Trust request.user from AuthMiddleware (JWT via Passport.js),
    // OR from the gateway's forwarded user header when HMAC-authenticated.
    // The HMAC signature proves the request came from our gateway, which
    // already validated the user's JWT before forwarding.
    let user: ILogin | undefined = request?.user;
    if (
      !user &&
      request?.headers?.['x-hmac-auth'] &&
      request?.headers?.['user']
    ) {
      try {
        user = JSON.parse(request.headers['user'] as string);
        if (request) request.user = user;
      } catch {
        // Invalid user header — fall through to denial
      }
    }

    if (user && isLoggedIn(user)) {
      const hasRole = requiredRoles.some((role) => user.roles?.includes(role));

      if (!hasRole) {
        // Audit: Authorization denied - insufficient role
        // @see https://github.com/OpusPopuli/opuspopuli/issues/191
        auditAuthorizationDenied(this.auditLogService, this.logger, {
          serviceName: 'roles-guard',
          user,
          info,
          request,
          errorMessage: `Insufficient role. Required: ${requiredRoles.join(', ')}`,
          logMessage: `Role-based access denied for user ${user.email} to ${info?.fieldName || 'unknown'}. Required: ${requiredRoles.join(', ')}`,
          inputVariables: { requiredRoles, userRoles: user.roles },
        });
      }

      return hasRole;
    }

    return false;
  }
}

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

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    // SECURITY: Use request.user set by AuthMiddleware after JWT validation
    // Never trust request.headers.user as it can be spoofed
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/183
    const user: ILogin | undefined = request.user;

    if (user && isLoggedIn(user)) {
      const hasRole = requiredRoles.some((role) => user.roles?.includes(role));

      if (!hasRole) {
        // Audit: Authorization denied - insufficient role
        // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/191
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

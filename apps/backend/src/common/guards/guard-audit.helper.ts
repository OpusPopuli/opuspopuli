import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { GraphQLResolveInfo } from 'graphql';
import { Request } from 'express';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { ILogin } from 'src/interfaces/login.interface';

/**
 * Emit a synchronous AUTHORIZATION_DENIED audit log entry and a logger
 * warning. Extracted from RolesGuard and PoliciesGuard to avoid duplicating
 * the identical `auditLogService?.logSync(...)` block in every guard.
 */
export function auditAuthorizationDenied(
  auditLogService: AuditLogService | undefined,
  logger: Logger,
  {
    serviceName,
    user,
    info,
    request,
    errorMessage,
    logMessage,
    inputVariables,
  }: {
    serviceName: string;
    user: ILogin;
    info: GraphQLResolveInfo | undefined;
    request: Request | undefined;
    errorMessage: string;
    logMessage: string;
    inputVariables: Record<string, unknown>;
  },
): void {
  auditLogService?.logSync({
    requestId: randomUUID(),
    serviceName,
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
      (request as { ip?: string })?.ip ||
      (request?.headers as Record<string, string>)?.['x-forwarded-for'],
    userAgent: request?.headers?.['user-agent'],
    errorMessage,
    inputVariables,
  });
  logger.warn(logMessage);
}

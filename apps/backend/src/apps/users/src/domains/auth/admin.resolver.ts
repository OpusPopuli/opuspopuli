import { Args, ID, Mutation, Resolver, Context } from '@nestjs/graphql';
import { Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { UserInputError } from '@nestjs/apollo';

import { AuthService } from './auth.service';

import { Role } from 'src/common/enums/role.enum';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { GqlContext } from 'src/common/utils/graphql-context';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { IAuditContext } from 'src/common/interfaces/audit.interface';

/**
 * Admin Resolver
 *
 * Handles admin-only user management operations:
 * - User confirmation
 * - Permission management (grant/revoke admin role)
 *
 * All operations require @Roles(Role.Admin).
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/464
 */
@Resolver(() => Boolean)
export class AdminResolver {
  private readonly serviceName = 'users-service';

  constructor(
    private readonly authService: AuthService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  private createAuditContext(
    context: GqlContext,
    userEmail?: string,
  ): IAuditContext {
    const user = context.req?.user;
    return {
      requestId: randomUUID(),
      userId: user?.id,
      userEmail: userEmail || user?.email,
      ipAddress:
        context.req?.ip ||
        (context.req?.headers as Record<string, string>)?.['x-forwarded-for'],
      userAgent: context.req?.headers?.['user-agent'],
      serviceName: this.serviceName,
    };
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async confirmUser(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.confirmUser(id);

    // Audit: User confirmation
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.USER_CONFIRMED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'confirmUser',
      operationType: 'mutation',
    });

    if (!result) throw new UserInputError('User not confirmed!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async addAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.addPermission(id, Role.Admin);

    // Audit: Admin permission granted
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PERMISSION_GRANTED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'addAdminPermission',
      operationType: 'mutation',
      newValues: { role: Role.Admin },
    });

    if (!result)
      throw new UserInputError('Admin Permissions were not granted!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async removeAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.removePermission(id, Role.Admin);

    // Audit: Admin permission revoked
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PERMISSION_REVOKED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'removeAdminPermission',
      operationType: 'mutation',
      previousValues: { role: Role.Admin },
    });

    if (!result)
      throw new UserInputError('Admin Permissions were not revoked!');
    return result;
  }
}

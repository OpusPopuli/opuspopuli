import { Args, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';
import { Optional, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { UserInputError } from '@nestjs/apollo';

import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasskeyCredential } from './dto/passkey.dto';
import { PasskeyService } from './services/passkey.service';

import { Permissions } from 'src/common/decorators/permissions.decorator';
import { Action } from 'src/common/enums/action.enum';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import {
  GqlContext,
  getUserFromContext,
  createAuditContext,
} from 'src/common/utils/graphql-context';
import { clearAuthCookies } from 'src/common/utils/cookie.utils';
import { AuditLogService } from 'src/common/services/audit-log.service';

/**
 * Session Resolver
 *
 * Handles authenticated user session operations:
 * - Logout (cookie clearing)
 * - Password changes
 * - Passkey credential management (list, delete)
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/464
 */
@Resolver(() => Boolean)
@UseGuards(AuthGuard)
export class SessionResolver {
  private readonly serviceName = 'users-service';

  constructor(
    private readonly authService: AuthService,
    private readonly passkeyService: PasskeyService,
    private readonly configService: ConfigService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  @Mutation(() => Boolean)
  @Permissions({
    action: Action.Update,
    subject: 'User',
    conditions: { id: '{{ id }}' },
  })
  async changePassword(
    @Args('changePasswordDto') changePasswordDto: ChangePasswordDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = createAuditContext(context, this.serviceName);

    let passwordUpdated: boolean;
    try {
      passwordUpdated =
        await this.authService.changePassword(changePasswordDto);

      // Audit: Password change success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.PASSWORD_CHANGE,
        success: true,
        resolverName: 'changePassword',
        operationType: 'mutation',
      });
    } catch (error) {
      // Audit: Password change failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSWORD_CHANGE_FAILED,
        success: false,
        resolverName: 'changePassword',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
    return passwordUpdated;
  }

  @Query(() => [PasskeyCredential])
  async myPasskeys(
    @Context() context: GqlContext,
  ): Promise<PasskeyCredential[]> {
    const user = getUserFromContext(context);
    const credentials = await this.passkeyService.getUserCredentials(user.id);
    // Map database types (null) to GraphQL types (undefined)
    return credentials.map((cred) => ({
      id: cred.id,
      friendlyName: cred.friendlyName ?? undefined,
      deviceType: cred.deviceType ?? undefined,
      createdAt: cred.createdAt,
      lastUsedAt: cred.lastUsedAt,
    }));
  }

  @Mutation(() => Boolean)
  async deletePasskey(
    @Args('credentialId') credentialId: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    const auditContext = createAuditContext(
      context,
      this.serviceName,
      user.email,
    );

    const result = await this.passkeyService.deleteCredential(
      credentialId,
      user.id,
    );

    // Audit: Passkey deletion
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PASSKEY_DELETED,
      success: result,
      entityType: 'PasskeyCredential',
      entityId: credentialId,
      resolverName: 'deletePasskey',
      operationType: 'mutation',
    });

    return result;
  }

  @Mutation(() => Boolean)
  async logout(@Context() context: GqlContext): Promise<boolean> {
    const auditContext = createAuditContext(context, this.serviceName);

    // Clear httpOnly auth cookies
    if (context.res) {
      clearAuthCookies(context.res, this.configService);
    }

    // Audit: Logout
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.LOGOUT,
      success: true,
      resolverName: 'logout',
      operationType: 'mutation',
    });

    return true;
  }
}

import {
  AnyMongoAbility,
  subject as an,
  Subject as CaslSubject,
} from '@casl/ability';
import {
  CHECK_PERMISSIONS,
  RequiredPermissions,
} from '../decorators/permissions.decorator';
import {
  CaslAbilityFactory,
  Subject,
} from '../../permissions/casl-ability.factory';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { cloneDeep, isEmpty } from 'lodash';
import { randomUUID } from 'node:crypto';

import { ILogin } from 'src/interfaces/login.interface';
import { isLoggedIn } from 'src/common/auth/jwt.strategy';

import { Action } from '../enums/action.enum';
import { AuditAction } from '../enums/audit-action.enum';

import { IPolicy } from 'src/interfaces/policy.interface';
import { IUserPolicies } from 'src/interfaces/user.interface';
import { IFilePolicies } from 'src/interfaces/file.interface';
import { AuditLogService } from 'src/common/services/audit-log.service';

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

interface IPermissions {
  subject: string;
  policies: IPolicy[];
}

export const permissions: IPermissions[] = [
  { subject: 'User', policies: IUserPolicies },
  { subject: 'File', policies: IFilePolicies },
];

@Injectable()
export class PoliciesGuard<
  A extends string = Action,
  S extends CaslSubject = Subject,
> implements CanActivate {
  private readonly logger = new Logger(PoliciesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(CaslAbilityFactory)
    private readonly caslAbilityFactory: CaslAbilityFactory<A, S>,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Main method that determines if the current request can proceed based on defined policies.
   * @param context - The execution context, containing the request and response objects.
   * @returns A boolean indicating whether the request is allowed.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const info = ctx.getInfo();
    const request = ctx.getContext().req;

    // Allow federation/introspection queries from HMAC-authenticated sources
    // These are internal queries from the API Gateway for schema composition
    const fieldName = info?.fieldName;
    if (fieldName && FEDERATION_INTROSPECTION_FIELDS.has(fieldName)) {
      const hasHmacAuth = request?.headers?.['x-hmac-auth'];
      if (hasHmacAuth) {
        return true;
      }
    }

    // Retrieve policies defined for the route handler and class
    const requiredPolicies =
      this.reflector.getAllAndOverride<RequiredPermissions<A, S>[]>(
        CHECK_PERMISSIONS,
        [ctx.getHandler(), ctx.getClass()],
      ) || [];

    if (isEmpty(requiredPolicies)) {
      return true;
    }

    const args = ctx.getArgs();

    // SECURITY: Use request.user set by AuthMiddleware after JWT validation
    // Never trust request.headers.user as it can be spoofed
    // @see https://github.com/OpusPopuli/opuspopuli/issues/183
    const user: ILogin | undefined = request.user;

    if (user && isLoggedIn(user)) {
      // Define the abilities based on the user's policies
      const ability = await this.caslAbilityFactory.defineAbility(
        permissions,
        user,
      );

      const conditionContext: Record<string, unknown> = {};

      // Set the context for the policies
      for (const policy of requiredPolicies) {
        conditionContext[policy.subject as string] = !isEmpty(policy.conditions)
          ? this.caslAbilityFactory.replacePlaceholders(
              cloneDeep(policy.conditions),
              args,
            )
          : undefined;
      }

      // Check if all policies are satisfied
      const allowed = this.checkPolicies(
        requiredPolicies,
        ability,
        conditionContext,
      );

      if (!allowed) {
        // Audit: Authorization denied - policy check failed
        // @see https://github.com/OpusPopuli/opuspopuli/issues/191
        this.auditLogService?.logSync({
          requestId: randomUUID(),
          serviceName: 'policies-guard',
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
          errorMessage: 'Policy check failed',
          inputVariables: {
            requiredPolicies: requiredPolicies.map((p) => ({
              action: p.action,
              subject: p.subject,
            })),
          },
        });

        this.logger.warn(
          `Policy-based access denied for user ${user.email} to ${info?.fieldName || 'unknown'}`,
        );
      }

      return allowed;
    }

    return false;
  }

  /**
   * Checks if all policies are satisfied based on the abilities and condition context.
   * @param policies - The array of policies to be checked.
   * @param ability - The ability object that checks permissions.
   * @param conditionContext - The context object containing fetched entities.
   * @returns A boolean indicating whether all policies are satisfied.
   */
  private checkPolicies(
    policies: RequiredPermissions<A, S>[],
    abilities: AnyMongoAbility,
    conditionContext: Record<string, unknown>,
  ): boolean {
    return policies.every((policy) => {
      const subject: string = policy.subject as string;

      return abilities.can(
        policy.action,
        conditionContext[subject]
          ? an(subject, conditionContext[subject])
          : policy.subject,
      );
    });
  }
}

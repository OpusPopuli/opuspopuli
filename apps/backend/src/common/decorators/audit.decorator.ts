import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../enums/audit-action.enum';

export interface AuditMetadata {
  /**
   * Optional (#1210): the interceptor falls back to verb inference when
   * absent, so a resolver can pin just the entityType — the field verb
   * inference gets wrong far more often than the action (it produced
   * `TextFromFile` and undefined for six of eight documents mutations).
   */
  action?: AuditAction;
  entityType?: string;
  entityIdArg?: string; // Name of the arg containing entity ID
  skipAudit?: boolean;
}

export const AUDIT_METADATA_KEY = 'audit_metadata';

/**
 * Decorator to explicitly configure audit logging for a resolver.
 * When applied, the GraphQL audit interceptor will use this metadata
 * instead of inferring values from the operation.
 *
 * @example
 * @Audit({ action: AuditAction.LOGIN, entityType: 'Auth' })
 * async loginUser(...) { }
 *
 * @Audit({ action: AuditAction.DELETE, entityType: 'User', entityIdArg: 'userId' })
 * async deleteUser(@Args('userId') userId: string) { }
 */
export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_METADATA_KEY, metadata);

/**
 * Decorator to skip audit logging for a specific resolver.
 * Use sparingly - most operations should be audited.
 *
 * @example
 * @SkipAudit()
 * async healthCheck() { }
 */
export const SkipAudit = () =>
  SetMetadata(AUDIT_METADATA_KEY, { skipAudit: true });

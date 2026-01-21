/**
 * Soft Delete Utilities for qckstrt Backend
 *
 * Provides utilities for implementing soft delete functionality across
 * the application. Soft delete logic is implemented at the service layer
 * for type safety and flexibility.
 */

/**
 * Models that support soft delete (have deletedAt field)
 */
export const SOFT_DELETE_MODELS = [
  'User',
  'Document',
  'Representative',
  'Proposition',
  'Meeting',
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

/**
 * Checks if a model supports soft delete
 */
export function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODELS.includes(model as SoftDeleteModel);
}

/**
 * Soft delete where clause helper
 * Use this to filter out soft-deleted records in queries
 *
 * @example
 * ```typescript
 * const users = await db.user.findMany({
 *   where: { ...softDeleteWhere },
 * });
 * ```
 */
export const softDeleteWhere = { deletedAt: null } as const;

/**
 * Creates soft delete data for update operations
 * Use this when converting a delete to a soft delete
 *
 * @example
 * ```typescript
 * await db.user.update({
 *   where: { id },
 *   data: softDeleteData(),
 * });
 * ```
 */
export function softDeleteData(): { deletedAt: Date } {
  return { deletedAt: new Date() };
}

/**
 * Creates restore data for soft-deleted records
 *
 * @example
 * ```typescript
 * await db.user.update({
 *   where: { id },
 *   data: restoreData(),
 * });
 * ```
 */
export function restoreData(): { deletedAt: null } {
  return { deletedAt: null };
}

/**
 * Injection tokens for the Region module.
 *
 * Separated from region.module.ts to avoid circular imports
 * (region.service.ts ↔ region.module.ts).
 */
export const REGION_CACHE = Symbol('REGION_CACHE');

import { Prisma } from '@opuspopuli/relationaldb-provider';

// `import type`, not a value import: `funding-basis.service.ts` imports
// `toNumber` from here, so a value import would be a runtime cycle. A
// type-only import is erased entirely.
import type { FundingBasis } from './funding-basis.service';

/**
 * Shared helpers for the campaign-finance read surfaces.
 *
 * Both funding services had grown byte-identical private copies of each of
 * these, which is the drift `FundingBasisService` exists to prevent one level
 * up: the cache-revival rule in particular is shared policy, and it HAD
 * already drifted — the representative copy was covered by a test and the
 * proposition copy was not (#991).
 */

/** Coerce `Prisma.Decimal | null | undefined` to a JS number. */
export function toNumber(value: Prisma.Decimal | null | undefined): number {
  // `toNumber()` rather than `Number(value)`, which goes through toString().
  return value ? value.toNumber() : 0;
}

/**
 * Revive a `FundingBasis` read back out of the cache, or return false if the
 * entry predates the field and must be recomputed.
 *
 * Two things JSON loses:
 *
 * - **Dates.** Left as strings they reach the GraphQL Date scalar as strings;
 *   revived from null, `new Date(null)` is the epoch. Both are fabrications.
 * - **Fields that did not exist when the entry was written.** Substituting the
 *   all-zero basis would be worse than failing: it asserts "nothing undated"
 *   about a figure nobody measured. Treating it as a miss is self-healing and
 *   costs one recompute.
 *
 * The cache KEY carries a version, which is the primary defence — a shape
 * change makes every old entry unreadable by construction. This is the
 * belt-and-braces for a version someone forgets to bump.
 */
export function reviveBasis(basis: FundingBasis | undefined): boolean {
  if (!basis || typeof basis.measured !== 'boolean') return false;
  basis.asOfSource = basis.asOfSource ? new Date(basis.asOfSource) : null;
  return true;
}

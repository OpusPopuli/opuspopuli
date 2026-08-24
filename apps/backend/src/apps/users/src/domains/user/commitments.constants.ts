/**
 * Server-side constant for the currently published ethical commitments
 * version, re-exported from the single source of truth in
 * `@opuspopuli/common` (#844).
 *
 * The `acknowledgeCommitments` mutation rejects any other value, so a
 * stale client cannot side-step a re-acknowledgement triggered by a
 * version bump. Before #844 this string was maintained by hand in two
 * places with a "remember to update both" procedure; the bump procedure
 * now lives with the constant in
 * `packages/common/src/commitments.ts`.
 */
export { CURRENT_COMMITMENTS_VERSION } from '@opuspopuli/common';

/**
 * Server-side constant for the currently published ethical commitments
 * version (#754). Must stay in lockstep with the frontend's
 * `COMMITMENTS_VERSION` in `apps/frontend/lib/commitments.ts` — the
 * `acknowledgeCommitments` mutation rejects any other value so a stale
 * client cannot side-step a re-acknowledgement triggered by a version
 * bump.
 *
 * Bump procedure when material commitment text changes:
 *  1. Update `apps/frontend/lib/commitments.ts::COMMITMENTS_VERSION`
 *     and append a `COMMITMENTS_HISTORY` entry.
 *  2. Update this constant to the same value.
 *  3. Deploy backend first (so existing clients can still acknowledge
 *     the prior version while the new one rolls out, AND new clients
 *     can immediately acknowledge the new version).
 *  4. Frontend deploy follows. Old clients on the prior version are
 *     re-prompted on next mount because their stored
 *     `commitmentsVersionAcknowledged` lags `COMMITMENTS_VERSION`.
 */
export const CURRENT_COMMITMENTS_VERSION = '1.0.0';

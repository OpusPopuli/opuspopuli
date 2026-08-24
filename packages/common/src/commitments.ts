/**
 * Single source of truth for the published ethical-commitments version
 * (#844, from the #754 review).
 *
 * It previously lived in two places — the frontend's JSON and a backend
 * constant — with a documented "remember to update both" procedure. A
 * contributor updating only one desyncs the system: the
 * `acknowledgeCommitments` mutation rejects any version but its own, so a
 * frontend on the newer string cannot acknowledge at all. That bites the
 * first time the version is bumped, which is precisely when nobody is
 * looking for it.
 *
 * The value itself lives in `commitments-version.json` rather than this
 * file so the PDF generator (a plain .mjs script, no TypeScript) can read
 * the same bytes.
 *
 * Bump procedure:
 *  1. Update `commitments-version.json` (version + lastUpdated).
 *  2. Append a `COMMITMENTS_HISTORY` entry in
 *     `apps/frontend/lib/commitments.ts`.
 *  3. Deploy the backend first, so existing clients can still acknowledge
 *     the prior version while the new one rolls out.
 *  4. Frontend deploy follows; clients whose stored
 *     `commitmentsVersionAcknowledged` lags are re-prompted on next mount.
 */
import commitmentsVersionFile from "./commitments-version.json";

export const CURRENT_COMMITMENTS_VERSION: string =
  commitmentsVersionFile.version;

/** ISO date the current commitments text was last materially changed. */
export const COMMITMENTS_LAST_UPDATED: string =
  commitmentsVersionFile.lastUpdated;

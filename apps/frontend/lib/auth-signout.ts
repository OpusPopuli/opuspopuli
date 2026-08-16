/**
 * Server-side sign-out.
 *
 * Calls the gateway's logout route, which clears the httpOnly auth cookies and
 * revokes the session at the auth provider. Cookies are httpOnly, so this is
 * the ONLY way the browser can be made to stop being signed in — nothing in
 * JavaScript can clear them directly.
 *
 * Replaces a `mutation Logout { logout }` call that did not work. It failed
 * two different ways at once: the mutation is auth-guarded, so it returned
 * `Forbidden resource` once the 15-minute access token lapsed, and even when
 * it succeeded the cookie clearing was performed on the users subgraph's
 * response and never reached the browser. The observable result was a user who
 * clicked "log out", got no error, and stayed signed in — long enough to
 * register a new account and land in the old account's data.
 */
import { getCsrfToken } from "./csrf";

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";

/**
 * Derived from the GraphQL origin rather than configured separately, exactly
 * as the refresh route is, so the two cannot drift apart across environments.
 */
const LOGOUT_URL = `${GRAPHQL_URL.replace(/\/$/, "")}/auth/logout`;

/**
 * Ask the server to end the session.
 *
 * Never throws and never reports failure. Callers proceed to clear local state
 * and navigate regardless, because there is no useful branch on the outcome:
 * if the server could not be reached, leaving the user on a signed-in-looking
 * screen is strictly worse than signing them out locally and letting the dead
 * cookie fail on its next use.
 */
export async function requestServerSignOut(): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      // Without this the gateway's CSRF middleware rejects the POST outright
      // and no cookie is ever cleared. The mutation this replaces omitted it.
      headers["X-CSRF-Token"] = csrfToken;
    }

    await fetch(LOGOUT_URL, {
      method: "POST",
      // Required: the auth cookies are httpOnly, so this is how they reach the
      // server. No body — the cookie is the only thing being acted on.
      credentials: "include",
      headers,
    });
  } catch {
    // Deliberately swallowed; see the contract above.
  }
}

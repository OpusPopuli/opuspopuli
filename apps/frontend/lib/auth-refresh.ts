/**
 * Silent session renewal.
 *
 * The access-token cookie lasts 15 minutes and nothing used to renew it, so an
 * actively-used session died mid-use and bounced the user to `/login`. This
 * calls the gateway's renewal route so that stops happening.
 *
 * See issue #977 and `docs/plans/977-session-refresh-flow.md`.
 */
import { getCsrfToken } from "./csrf";

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";

/**
 * The renewal route sits alongside the GraphQL endpoint — `/api` becomes
 * `/api/auth/refresh` — because the refresh cookie is path-scoped to exactly
 * that URL and is sent nowhere else. Derived from the same origin rather than
 * configured separately, so the two cannot drift apart across environments.
 */
const REFRESH_URL = `${GRAPHQL_URL.replace(/\/$/, "")}/auth/refresh`;

/**
 * - `renewed` — new cookies are set; the caller should retry its operation.
 * - `expired` — the session is genuinely dead; sign in again.
 * - `unavailable` — renewal could not be attempted or the server could not
 *   answer. This says NOTHING about whether the session is still valid, so the
 *   caller must not sign the user out on it.
 */
export type RefreshOutcome = "renewed" | "expired" | "unavailable";

/**
 * Single-flight latch. A page load fires many queries at once, so an expired
 * token produces a burst of simultaneous failures. Without this every one of
 * them would launch its own renewal, and because the provider rotates refresh
 * tokens, the later ones would present a token the earlier ones had already
 * consumed — manufacturing the forced logout this code exists to prevent.
 */
let inFlight: Promise<RefreshOutcome> | null = null;

/** Test-only: drop the in-flight latch between cases. */
export function resetRefreshStateForTests(): void {
  inFlight = null;
}

async function performRefresh(): Promise<RefreshOutcome> {
  try {
    const headers: Record<string, string> = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const response = await fetch(REFRESH_URL, {
      method: "POST",
      // Required: the refresh cookie is httpOnly, so this is the only way it
      // reaches the server. There is deliberately no request body — the
      // credential is the cookie, never anything JavaScript can read.
      credentials: "include",
      headers,
    });

    if (response.ok) return "renewed";
    // 401 is the server telling us the grant was rejected. Anything else —
    // 503, a proxy error, a gateway restart — is not evidence of expiry.
    return response.status === 401 ? "expired" : "unavailable";
  } catch {
    // Offline, DNS failure, request aborted. Never treated as expiry.
    return "unavailable";
  }
}

/**
 * Renew the session, collapsing concurrent callers into a single request.
 *
 * The latch is released once the request settles — including on failure — so
 * a tab can renew again 15 minutes later. Holding it would make the first
 * renewal the only one that tab ever performs.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  inFlight ??= performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

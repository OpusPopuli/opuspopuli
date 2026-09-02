/**
 * Read the CSRF token the backend sets on every response.
 *
 * Deliberately NOT httpOnly — the double-submit pattern requires JavaScript to
 * read this value and echo it back in the `X-CSRF-Token` header, which the
 * server then compares against the cookie. Same-origin policy is what stops
 * another site reading it.
 *
 * Shared by the Apollo transport and the session-renewal call so the two
 * cannot drift apart; both hit gateway routes guarded by the same
 * `CsrfMiddleware`.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */
export function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;

  const csrfCookie = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("csrf-token="));

  return csrfCookie ? decodeURIComponent(csrfCookie.split("=")[1]) : undefined;
}

/**
 * Read the CSRF token, re-seeding it from the gateway if the cookie is gone.
 *
 * `CsrfMiddleware` sets or refreshes `csrf-token` on **every** response, and
 * treats GET/HEAD/OPTIONS as safe — so one GET is enough to recover a missing
 * cookie, and that GET cannot itself be rejected for lacking the token.
 *
 * Without this, an absent cookie is not a recoverable condition but a forced
 * logout (#1089):
 *
 *   cookie absent -> the transport sends a bare POST -> 403
 *   -> `isAuthExpiredError` counts 403 as an expired session
 *   -> renewal runs and the operation is retried once
 *   -> the retry still has no token -> 403 again
 *   -> terminal handler clears local state and redirects to /login
 *
 * The user is signed out of a session that was never invalid. Production logs
 * for #1089 show exactly this shape: five consecutive CSRF 403s.
 *
 * Returns `undefined` if the token is still missing afterwards, so the caller
 * can fail deliberately rather than sending a request that is certain to 403.
 */
export async function ensureCsrfToken(
  graphqlUrl: string,
): Promise<string | undefined> {
  const existing = getCsrfToken();
  if (existing) return existing;

  try {
    // Same origin, credentials included, so Set-Cookie applies. The response
    // body is irrelevant — the cookie is the point, and a GraphQL endpoint
    // answering GET with 400 still carries the refreshed cookie.
    await fetch(graphqlUrl, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
  } catch {
    // Offline or the gateway is unreachable. Fall through: the caller gets
    // undefined and decides, which is the point of this function.
  }

  return getCsrfToken();
}

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

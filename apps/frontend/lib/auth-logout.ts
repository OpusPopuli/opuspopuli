/**
 * Terminal auth-expired side-effect module.
 *
 * When a GraphQL response indicates the user's session is no longer valid
 * (HTTP 403, or `extensions.code` === `FORBIDDEN` / `UNAUTHENTICATED`), the
 * Apollo `authExpiryLink` calls `triggerAuthExpiredRedirect` here. We
 * intentionally do NOT bridge back into the React AuthContext — the
 * `AuthProvider` lives inside the `ApolloProvider`, so a React-aware bridge
 * would be a circular-dependency hazard. Instead we perform the side effects
 * directly (clear localStorage, fire a best-effort backend logout, full-page
 * navigate to `/login`), and `AuthProvider` rehydrates as unauthenticated on
 * the next page load.
 *
 * See issue #610 and plan at plans/composed-dancing-jellyfish.md.
 */
import type { ErrorLike } from "@apollo/client";
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from "@apollo/client/errors";
import { USER_KEY } from "./auth-context";

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";

/** Error codes that mean "your session is no longer valid, sign in again". */
const EXPIRED_SESSION_CODES = new Set(["FORBIDDEN", "UNAUTHENTICATED"]);

/**
 * Returns true when the Apollo error indicates an expired/invalid session.
 * Matches HTTP 403 on network errors and `FORBIDDEN`/`UNAUTHENTICATED` on
 * GraphQL errors. Returns false for business-logic errors, 5xx, missing
 * data, etc.
 */
export function isAuthExpiredError(error: ErrorLike | undefined): boolean {
  if (!error) return false;

  if (CombinedGraphQLErrors.is(error)) {
    return error.errors.some((e) => {
      const code = e.extensions?.code;
      return typeof code === "string" && EXPIRED_SESSION_CODES.has(code);
    });
  }

  if (CombinedProtocolErrors.is(error)) return false;

  // Network-level error. Apollo surfaces the original fetch Response as
  // `statusCode` on certain link failures; check defensively.
  const statusCode = (error as { statusCode?: number }).statusCode;
  return statusCode === 403 || statusCode === 401;
}

/**
 * Module-level idempotency flag. Once the first 403 triggers a navigation,
 * subsequent in-flight 403s are no-ops — we've already committed to redirect
 * and the page is about to unload.
 *
 * Exported for testing only; production callers should treat it as private.
 */
export function resetLogoutInProgressForTests(): void {
  logoutInProgress = false;
}
let logoutInProgress = false;

/**
 * Navigation seam. Production uses a full-page navigation so the whole
 * app unmounts and AuthProvider rehydrates fresh as unauthenticated on
 * the next load. Tests override this to avoid jsdom's non-configurable
 * `window.location`.
 */
let performRedirect: (url: string) => void = (url) => {
  globalThis.location.assign(url);
};

/** Test-only: swap the navigation implementation. */
export function setPerformRedirectForTests(fn: (url: string) => void): void {
  performRedirect = fn;
}

/**
 * Clear local auth state, fire-and-forget the backend logout mutation, and
 * navigate to `/login` with `?redirect=<prev-path>&reason=expired`.
 *
 * - Idempotent: concurrent calls collapse to a single navigation.
 * - Public-page gate: if `USER_KEY` isn't in localStorage, the user was
 *   never logged in, so a 403 is an expected permission error on a public
 *   page. No redirect, no-op.
 */
/**
 * Paths that are themselves the re-authentication flow — redirecting
 * here from a 403 would cause an infinite loop (e.g. if the login page
 * makes an authenticated query). Both `pathname` and the location
 * check short-circuit if we're already on one of these.
 */
const AUTH_ROUTE_PREFIXES = ["/login", "/register", "/auth/"] as const;

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}

export function triggerAuthExpiredRedirect(pathname: string): void {
  if (logoutInProgress || globalThis.window === undefined) return;
  if (localStorage.getItem(USER_KEY) === null) return;
  // Already on an auth route? A 403 here doesn't need to redirect us
  // anywhere — we're already where we'd send the user. Clear stale
  // state (they may be mid-expiry) but don't navigate.
  if (isAuthRoute(pathname)) {
    localStorage.removeItem(USER_KEY);
    return;
  }
  logoutInProgress = true;

  localStorage.removeItem(USER_KEY);

  // Best-effort backend logout to clear httpOnly cookies. Fire via raw
  // fetch (not Apollo) so we don't re-enter the link chain during an
  // auth-failure path. Failures are ignored — the navigation below is
  // the user-visible outcome either way.
  fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "mutation Logout { logout }",
      operationName: "Logout",
    }),
  }).catch(() => {});

  const redirect = encodeURIComponent(pathname || "/");
  performRedirect(`/login?redirect=${redirect}&reason=expired`);
}

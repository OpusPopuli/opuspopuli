/**
 * Terminal auth-expired side-effect module.
 *
 * When a GraphQL response indicates the user's session is no longer valid
 * (`extensions.code` === `UNAUTHENTICATED`, or a network-level 401/403), the
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
import { purgePersistedCache } from "./apollo-cache-keys";
import { requestServerSignOut } from "./auth-signout";

/**
 * Error codes that mean "your session is no longer valid, sign in again".
 *
 * ONLY `UNAUTHENTICATED`. `FORBIDDEN` used to be here too, but the backend
 * guards conflated the two: a not-signed-in request and a genuine
 * authorization denial both returned `FORBIDDEN`, so a user who simply
 * lacked permission for one operation was logged out of the whole app. The
 * guards now throw `UnauthorizedException` (=> `UNAUTHENTICATED`) only for
 * "not signed in"; a real `@Permissions`/`@Roles` denial stays `FORBIDDEN`
 * and must NOT end the session. This set is the frontend half of that split
 * and depends on the backend change being deployed first.
 */
const EXPIRED_SESSION_CODES = new Set(["UNAUTHENTICATED"]);

/**
 * Returns true when the Apollo error indicates an expired/invalid session.
 * Matches `UNAUTHENTICATED` on GraphQL errors and HTTP 401/403 on network
 * errors. Returns false for business-logic errors, `FORBIDDEN` authorization
 * denials, 5xx, missing data, etc.
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
    purgePersistedCache();
    return;
  }
  logoutInProgress = true;

  localStorage.removeItem(USER_KEY);

  // Drop the persisted cache before navigating away. An expired session is one
  // of the ways a DIFFERENT person ends up signing in on this browser, and the
  // cache holds the previous user's profile, addresses and personalization
  // signals. Only the on-disk copy is touched here: this module deliberately
  // does not import apollo-client (that would be circular), and the full-page
  // navigation below tears the in-memory cache down anyway.
  purgePersistedCache();

  // Best-effort backend sign-out to clear the httpOnly cookies. Goes through
  // the gateway's REST route rather than Apollo, so we don't re-enter the link
  // chain during an auth-failure path.
  //
  // This used to POST `mutation Logout { logout }` directly, which cleared
  // nothing on this path for two reasons: no `X-CSRF-Token` header, so the
  // gateway rejected it 403 before it ran, and the mutation is auth-guarded,
  // so an expired session — the only way to reach this function — could not
  // have passed it anyway. The cookies survived every expiry-driven logout.
  void requestServerSignOut();

  const redirect = encodeURIComponent(pathname || "/");
  performRedirect(`/login?redirect=${redirect}&reason=expired`);
}

import { ApolloLink } from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import { Observable } from "@apollo/client/utilities";
import { isAuthExpiredError } from "./auth-logout";
import { refreshSession } from "./auth-refresh";

/**
 * Marks an operation that has already been retried after a renewal. Without
 * it a failing retry would trigger another refresh, which would trigger
 * another retry — a loop that hammers the auth provider and never terminates.
 */
export const AUTH_RETRIED = "authRetried";

/**
 * Suppresses the terminal expired-session redirect for this operation.
 *
 * Set only when renewal could not be ATTEMPTED — offline, or the gateway
 * answering 503. Those say nothing about whether the session is still valid,
 * and signing the user out on them would reintroduce #977's forced logout by
 * a different route. The query still fails and the UI still shows an error;
 * the session simply survives.
 */
export const SKIP_EXPIRED_REDIRECT = "skipAuthExpiredRedirect";

/**
 * Renews an expired session and retries the operation once, transparently.
 *
 * Sits BELOW the terminal `authExpiryLink` in the chain, so it gets first
 * refusal on an auth failure and the redirect only happens if renewal has
 * genuinely failed.
 */
/**
 * Routes where a session is being established or torn down, and where renewal
 * must NOT run.
 *
 * This caused a silent identity swap in production. During sign-in an in-flight
 * query 401s using the OUTGOING user's expired access token. Renewal fired,
 * and the request still carried the outgoing user's refresh cookie — so the
 * provider minted a valid token for THEM, and the gateway wrote it back,
 * clobbering the refresh cookie the new login had just set.
 *
 * The browser was then holding the new user's access token alongside the old
 * user's refresh token. Fifteen minutes later the access token expired,
 * renewal redeemed the old one, and the session became the previous user's
 * with no interaction at all. GoTrue's refresh_tokens table showed the tell:
 * a token minted for the arriving user, then another for the departing user
 * one second later, on every sign-in.
 *
 * On these routes a 401 means "not signed in yet" or "signing out", never
 * "session lapsed" — so there is nothing legitimate to renew. `auth-logout.ts`
 * guards the same paths for the same underlying reason.
 */
const AUTH_ROUTE_PREFIXES = ["/login", "/register", "/auth/"] as const;

function isOnAuthRoute(): boolean {
  const path = globalThis.location?.pathname ?? "";
  return AUTH_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const sessionRefreshLink: ApolloLink = new ErrorLink(
  ({ error, operation, forward }) => {
    // Logout failing with a 403 is expected — never try to renew for it.
    if (operation.operationName === "Logout") return;
    if (!isAuthExpiredError(error)) return;
    // Already retried once: let it through to the terminal handler.
    if (operation.getContext()[AUTH_RETRIED]) return;
    if (globalThis.window === undefined) return;
    // Mid sign-in or sign-out: renewing here renews the WRONG identity.
    if (isOnAuthRoute()) return;

    return new Observable((subscriber) => {
      let inner: { unsubscribe: () => void } | undefined;
      let cancelled = false;

      // Every concurrent failure lands here, but refreshSession() collapses
      // them into one network call — see the latch in auth-refresh.ts.
      refreshSession().then((outcome) => {
        if (cancelled) return;

        if (outcome === "renewed") {
          operation.setContext({ [AUTH_RETRIED]: true });
          inner = forward(operation).subscribe(subscriber);
          return;
        }

        if (outcome === "unavailable") {
          operation.setContext({ [SKIP_EXPIRED_REDIRECT]: true });
        }

        // Propagate the ORIGINAL error upward. `expired` reaches
        // authExpiryLink and redirects; `unavailable` reaches it and is
        // skipped by the flag just set.
        subscriber.error(error);
      });

      return () => {
        cancelled = true;
        inner?.unsubscribe();
      };
    });
  },
);

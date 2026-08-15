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
export const sessionRefreshLink: ApolloLink = new ErrorLink(
  ({ error, operation, forward }) => {
    // Logout failing with a 403 is expected — never try to renew for it.
    if (operation.operationName === "Logout") return;
    if (!isAuthExpiredError(error)) return;
    // Already retried once: let it through to the terminal handler.
    if (operation.getContext()[AUTH_RETRIED]) return;
    if (globalThis.window === undefined) return;

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

import { ApolloLink, gql } from "@apollo/client";
import { Observable } from "@apollo/client/utilities";
import {
  sessionRefreshLink,
  AUTH_RETRIED,
  SKIP_EXPIRED_REDIRECT,
} from "../lib/auth-refresh-link";
import type { RefreshOutcome } from "../lib/auth-refresh";

const mockRefreshSession = jest.fn<Promise<RefreshOutcome>, []>();
jest.mock("../lib/auth-refresh", () => ({
  refreshSession: () => mockRefreshSession(),
}));

const QUERY = gql`
  query Me {
    me {
      id
    }
  }
`;

const authError = Object.assign(new Error("Forbidden"), { statusCode: 403 });

/** Terminating link that fails the first N attempts, then succeeds. */
function createTerminatingLink(failures: number) {
  let attempts = 0;
  const link = new ApolloLink(
    () =>
      new Observable((subscriber) => {
        attempts += 1;
        if (attempts <= failures) {
          subscriber.error(authError);
        } else {
          subscriber.next({ data: { me: { id: "1" } } });
          subscriber.complete();
        }
      }),
  );
  return { link, getAttempts: () => attempts };
}

/** AC4 requires an execution context; nothing here touches the client. */
const EXEC_CONTEXT = { client: {} as never };

function run(link: ApolloLink) {
  return new Promise<{ data?: unknown; error?: unknown }>((resolve) => {
    ApolloLink.execute(link, { query: QUERY }, EXEC_CONTEXT).subscribe({
      next: (data) => resolve({ data }),
      error: (error) => resolve({ error }),
    });
  });
}

describe("sessionRefreshLink", () => {
  beforeEach(() => {
    mockRefreshSession.mockReset();
  });

  it("renews and retries the operation once, transparently", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const { link: terminating, getAttempts } = createTerminatingLink(1);

    const result = await run(
      ApolloLink.from([sessionRefreshLink, terminating]),
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(getAttempts()).toBe(2); // original + one retry
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  // The loop guard. If a retried operation could trigger another refresh, a
  // persistently-403ing query would spin forever against the auth provider.
  it("never refreshes twice for the same operation", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const { link: terminating, getAttempts } = createTerminatingLink(99);

    const result = await run(
      ApolloLink.from([sessionRefreshLink, terminating]),
    );

    expect(result.error).toBe(authError);
    expect(getAttempts()).toBe(2); // original + exactly one retry
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("gives up without retrying when the session is genuinely expired", async () => {
    mockRefreshSession.mockResolvedValue("expired");
    const { link: terminating, getAttempts } = createTerminatingLink(99);

    const result = await run(
      ApolloLink.from([sessionRefreshLink, terminating]),
    );

    expect(result.error).toBe(authError);
    expect(getAttempts()).toBe(1); // never retried
  });

  // The distinction carried all the way from the auth provider. An outage must
  // not read as expiry, or a GoTrue blip signs out every active user.
  it("flags unavailable so the terminal redirect is suppressed", async () => {
    mockRefreshSession.mockResolvedValue("unavailable");
    let observedContext: Record<string, unknown> = {};

    const inspector = new ApolloLink((operation, forward) => {
      const result = forward(operation);
      return new Observable((subscriber) =>
        result.subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => {
            observedContext = operation.getContext();
            subscriber.error(e);
          },
          complete: () => subscriber.complete(),
        }),
      );
    });

    const { link: terminating } = createTerminatingLink(99);
    await run(ApolloLink.from([inspector, sessionRefreshLink, terminating]));

    expect(observedContext[SKIP_EXPIRED_REDIRECT]).toBe(true);
    expect(observedContext[AUTH_RETRIED]).toBeUndefined();
  });

  it("does NOT flag expired failures — those must still redirect", async () => {
    mockRefreshSession.mockResolvedValue("expired");
    let observedContext: Record<string, unknown> = {};

    const inspector = new ApolloLink((operation, forward) => {
      const result = forward(operation);
      return new Observable((subscriber) =>
        result.subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => {
            observedContext = operation.getContext();
            subscriber.error(e);
          },
          complete: () => subscriber.complete(),
        }),
      );
    });

    const { link: terminating } = createTerminatingLink(99);
    await run(ApolloLink.from([inspector, sessionRefreshLink, terminating]));

    expect(observedContext[SKIP_EXPIRED_REDIRECT]).toBeUndefined();
  });

  /**
   * The production identity swap. On /auth/callback an in-flight query 401s
   * using the OUTGOING user's expired token; renewing there redeems that
   * user's refresh cookie and overwrites the cookies the new login just set.
   */
  it("does not renew while on an auth route", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const original = globalThis.location.pathname;
    globalThis.history.replaceState({}, "", "/auth/callback?type=register");

    const { link: terminating } = createTerminatingLink(99);
    await run(ApolloLink.from([sessionRefreshLink, terminating]));

    expect(mockRefreshSession).not.toHaveBeenCalled();

    globalThis.history.replaceState({}, "", original);
  });

  it("does renew on an ordinary app route", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const original = globalThis.location.pathname;
    globalThis.history.replaceState({}, "", "/me/briefing");

    const { link: terminating } = createTerminatingLink(1);
    await run(ApolloLink.from([sessionRefreshLink, terminating]));

    expect(mockRefreshSession).toHaveBeenCalled();

    globalThis.history.replaceState({}, "", original);
  });

  it("ignores non-auth errors entirely", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const serverError = Object.assign(new Error("boom"), { statusCode: 500 });
    const terminating = new ApolloLink(
      () => new Observable((subscriber) => subscriber.error(serverError)),
    );

    const result = await run(
      ApolloLink.from([sessionRefreshLink, terminating]),
    );

    expect(result.error).toBe(serverError);
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it("does not try to renew a failing Logout", async () => {
    mockRefreshSession.mockResolvedValue("renewed");
    const terminating = new ApolloLink(
      () => new Observable((subscriber) => subscriber.error(authError)),
    );

    await new Promise<void>((resolve) => {
      ApolloLink.execute(
        ApolloLink.from([sessionRefreshLink, terminating]),
        {
          query: gql`
            mutation Logout {
              logout
            }
          `,
        },
        EXEC_CONTEXT,
      ).subscribe({ error: () => resolve(), next: () => resolve() });
    });

    expect(mockRefreshSession).not.toHaveBeenCalled();
  });
});

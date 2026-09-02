import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
} from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";
import { persistCache, LocalStorageWrapper } from "apollo3-cache-persist";
import { isAuthExpiredError, triggerAuthExpiredRedirect } from "./auth-logout";
import { sessionRefreshLink, SKIP_EXPIRED_REDIRECT } from "./auth-refresh-link";
import { ensureCsrfToken } from "./csrf";
import {
  APOLLO_CACHE_KEY,
  LEGACY_APOLLO_CACHE_KEYS,
  registerCacheReset,
} from "./apollo-cache-keys";

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";
const GRAPHQL_WS_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_WS_URL || GRAPHQL_URL.replace(/^http/, "ws");

/**
 * Custom fetch that adds CSRF token for request protection
 *
 * SECURITY: CSRF tokens protect against cross-site request forgery attacks.
 * The token is read from a cookie and sent in a header - this works because:
 * 1. Same-origin policy prevents other sites from reading our cookies
 * 2. The backend validates that the header matches the cookie
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */
const customFetch: typeof fetch = async (uri, options) => {
  const headers = new Headers(options?.headers as HeadersInit);

  // Every GraphQL request is a POST, so every one needs the token. If the
  // cookie is missing, re-seed it rather than sending a request that is
  // certain to earn a 403 — a 403 is read as an expired session, and the
  // retry that follows has no token either, so the user is signed out of a
  // session that was never invalid (#1089).
  const csrfToken = await ensureCsrfToken(GRAPHQL_URL);
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  // Still missing means the gateway is unreachable. Send anyway: a network
  // failure is the honest outcome and Apollo's error handling covers it,
  // whereas throwing here would be indistinguishable from a CSRF rejection.

  return fetch(uri, {
    ...options,
    headers,
    credentials: "include", // Send httpOnly auth cookies
  });
};

const httpLink = new HttpLink({
  uri: GRAPHQL_URL,
  fetch: customFetch,
  credentials: "include", // Ensure cookies are sent
});

/**
 * Get auth token for WebSocket connection
 *
 * SECURITY: WebSocket connections require JWT authentication via connection params.
 * The access token is extracted from httpOnly cookie or localStorage.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/194
 */
function getAuthToken(): string | undefined {
  if (typeof document === "undefined") return undefined;

  // Try to get token from cookie (if accessible)
  const cookies = document.cookie.split("; ");
  const tokenCookie = cookies.find((cookie) =>
    cookie.startsWith("access-token="),
  );
  if (tokenCookie) {
    return decodeURIComponent(tokenCookie.split("=")[1]);
  }

  // Fallback: Get from localStorage if stored there
  const storedToken = globalThis.localStorage?.getItem("accessToken");
  if (storedToken) {
    return storedToken;
  }

  return undefined;
}

/**
 * Create WebSocket link for GraphQL subscriptions
 *
 * SECURITY: All WebSocket connections are authenticated via JWT in connection params.
 * Connections without valid tokens are rejected by the server.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/194
 */
function createWsLink(): ApolloLink | null {
  // WebSocket is not available during SSR
  if (globalThis.window === undefined) {
    return null;
  }

  const wsClient = createClient({
    url: GRAPHQL_WS_URL,
    connectionParams: () => {
      const token = getAuthToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
    // Retry connection with exponential backoff
    retryAttempts: 5,
    shouldRetry: () => true,
    // Lazy connection - only connect when subscription starts
    lazy: true,
    // Handle connection acknowledgement timeout
    connectionAckWaitTimeout: 10000,
  });

  return new GraphQLWsLink(wsClient);
}

/**
 * Error link that detects expired-session responses and redirects to
 * `/login?redirect=<prev>&reason=expired`. See issue #610 and
 * [lib/auth-logout.ts](./auth-logout.ts) for the side-effect logic.
 *
 * Placed at the HEAD of the link chain so it observes every failure from
 * the HTTP/WS links below it. Excludes the `Logout` mutation itself so a
 * 403 on logout doesn't recurse.
 */
const authExpiryLink = new ErrorLink(({ error, operation }) => {
  if (operation.operationName === "Logout") return;
  if (!isAuthExpiredError(error)) return;
  // Renewal was attempted below and could not reach the server — offline, or
  // the gateway answering 503. That is not evidence the session is dead, so
  // the query is allowed to fail without signing the user out. See #977.
  if (operation.getContext()[SKIP_EXPIRED_REDIRECT]) return;
  if (globalThis.window === undefined) return;
  triggerAuthExpiredRedirect(
    globalThis.location.pathname + globalThis.location.search,
  );
});

/**
 * Create the Apollo Link that routes subscriptions to WebSocket
 * and queries/mutations to HTTP, with the auth-expiry link at the head.
 */
function createLink(): ApolloLink {
  const wsLink = createWsLink();

  // If no WebSocket link (SSR), use HTTP only
  if (!wsLink) {
    return ApolloLink.from([authExpiryLink, sessionRefreshLink, httpLink]);
  }

  // Split traffic: subscriptions go to WebSocket, rest to HTTP
  const transportLink = ApolloLink.split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === "OperationDefinition" &&
        definition.operation === "subscription"
      );
    },
    wsLink,
    httpLink,
  );

  // Order matters. sessionRefreshLink sits BELOW authExpiryLink so it gets
  // first refusal on an auth failure: if renewal succeeds the operation is
  // retried and the error never reaches the redirect at all.
  return ApolloLink.from([authExpiryLink, sessionRefreshLink, transportLink]);
}

/**
 * Create the Apollo cache with optional persistence for offline support
 *
 * PWA FEATURE: Cache persistence enables offline-first behavior by storing
 * GraphQL query results in localStorage. When the app loads offline, it can
 * serve cached data immediately while attempting to fetch fresh data.
 */
const cache = new InMemoryCache();

// Initialize cache persistence for PWA offline support
if (globalThis.window !== undefined) {
  for (const legacyKey of LEGACY_APOLLO_CACHE_KEYS) {
    try {
      globalThis.localStorage.removeItem(legacyKey);
    } catch {
      // Storage may be unavailable (private mode, quota); the live cache
      // still works without persistence — non-fatal.
    }
  }
  persistCache({
    cache,
    key: APOLLO_CACHE_KEY,
    storage: new LocalStorageWrapper(globalThis.localStorage),
    maxSize: 1048576 * 5, // 5MB limit
    debug: process.env.NODE_ENV === "development",
  }).catch((error) => {
    // Non-fatal: app works without persistence, just logs warning
    console.warn("Apollo cache persistence failed:", error);
  });
}

export const apolloClient = new ApolloClient({
  link: createLink(),
  cache,
  // Enable SSR mode when running on server
  ssrMode: globalThis.window === undefined,
});

// clearStore, not resetStore: reset refetches every active query, which at
// logout means firing authenticated requests against a session being torn
// down. clearStore just empties.
registerCacheReset(async () => {
  await apolloClient.clearStore();
});

export interface DemoUser {
  id: string;
  email: string;
  roles: string[];
  department: string;
  clearance: string;
}

export const setDemoUser = (user: DemoUser) => {
  globalThis.localStorage.setItem("user", JSON.stringify(user));
};

export const getDemoUser = (): DemoUser | null => {
  if (globalThis.localStorage === undefined) return null;
  const userJson = globalThis.localStorage.getItem("user");
  return userJson ? JSON.parse(userJson) : null;
};

export const clearDemoUser = () => {
  globalThis.localStorage.removeItem("user");
};

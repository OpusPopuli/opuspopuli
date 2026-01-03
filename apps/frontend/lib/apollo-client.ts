import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";
const GRAPHQL_WS_URL =
  process.env.NEXT_PUBLIC_GRAPHQL_WS_URL || GRAPHQL_URL.replace(/^http/, "ws");

/**
 * Extract CSRF token from cookie
 *
 * The CSRF token is set by the backend on every response as a non-httpOnly cookie,
 * allowing JavaScript to read it and send it back in the X-CSRF-Token header.
 */
function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;

  const cookies = document.cookie.split("; ");
  const csrfCookie = cookies.find((cookie) => cookie.startsWith("csrf-token="));

  if (csrfCookie) {
    return decodeURIComponent(csrfCookie.split("=")[1]);
  }

  return undefined;
}

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

  // Add CSRF token from cookie for mutation protection
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

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
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
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
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
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
 * Create the Apollo Link that routes subscriptions to WebSocket
 * and queries/mutations to HTTP
 */
function createLink(): ApolloLink {
  const wsLink = createWsLink();

  // If no WebSocket link (SSR), use HTTP only
  if (!wsLink) {
    return httpLink;
  }

  // Split traffic: subscriptions go to WebSocket, rest to HTTP
  return split(
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
}

export const apolloClient = new ApolloClient({
  link: createLink(),
  cache: new InMemoryCache(),
  // Enable SSR mode when running on server
  ssrMode: globalThis.window === undefined,
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

import * as crypto from 'node:crypto';
import {
  SUPABASE_URL,
  waitFor,
  getMagicLinkFromInbucket,
  clearInbucketMailbox,
  generateTestEmail,
} from '../test-utils';
import { createUser, generateEmail } from './db-fixtures';
import { getDbService } from './db-cleanup';

// ============================================
// Configuration
// ============================================

// API Gateway URL - all integration tests go through here
// When running in Docker container: http://api:8080
// When running from host: http://localhost:3000
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const API_GATEWAY_PATH = '/api'; // GraphQL endpoint on the gateway

// HMAC configuration (for direct microservice access if needed)
const HMAC_SECRET =
  process.env.GATEWAY_HMAC_SECRET || 'integration-test-hmac-secret';
const HMAC_CLIENT_ID = process.env.GATEWAY_CLIENT_ID || 'api-gateway';

// CSRF token cache for API Gateway requests
let csrfToken: string | null = null;
let csrfCookie: string | null = null;

/**
 * Service URLs
 * - api: API Gateway (use this for integration tests)
 * - Individual services: For direct access (bypasses gateway)
 *
 * When running in Docker, these use container names.
 * When running from host, these use localhost with mapped ports.
 */
export const SERVICE_URLS = {
  api: API_GATEWAY_URL,
  // Direct service URLs (for debugging/isolated testing only)
  users: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  documents: process.env.DOCUMENTS_SERVICE_URL || 'http://localhost:3002',
  knowledge: process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3003',
  region: process.env.REGION_SERVICE_URL || 'http://localhost:3004',
};

// ============================================
// CSRF Token Management
// ============================================

/**
 * Fetches a CSRF token from the API Gateway.
 * Uses double-submit cookie pattern - gets token from cookie, sends in header.
 */
async function fetchCsrfToken(): Promise<{ token: string; cookie: string }> {
  const response = await fetch(`${API_GATEWAY_URL}${API_GATEWAY_PATH}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Extract csrf-token cookie from response
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error(
      'No set-cookie header in response - CSRF token not received',
    );
  }

  // Parse csrf-token from cookie
  const csrfMatch = /csrf-token=([^;]+)/.exec(setCookie);
  if (!csrfMatch) {
    throw new Error('csrf-token cookie not found in response');
  }

  const token = csrfMatch[1];
  return { token, cookie: `csrf-token=${token}` };
}

/**
 * Gets cached CSRF token or fetches a new one
 */
async function getCsrfToken(): Promise<{ token: string; cookie: string }> {
  if (!csrfToken || !csrfCookie) {
    const result = await fetchCsrfToken();
    csrfToken = result.token;
    csrfCookie = result.cookie;
  }
  return { token: csrfToken, cookie: csrfCookie };
}

/**
 * Clears cached CSRF token (call if token becomes invalid)
 */
export function clearCsrfToken(): void {
  csrfToken = null;
  csrfCookie = null;
}

// ============================================
// HMAC Authentication (for direct service access)
// ============================================

/**
 * Generates HMAC signature for authenticating requests to microservices directly
 */
function generateHmacHeader(
  method: string,
  path: string,
  contentType: string = 'application/json',
): string {
  const headers = '@request-target,content-type';
  const signatureString = `${method.toLowerCase()} ${path}\ncontent-type: ${contentType}`;

  const signature = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(signatureString)
    .digest('base64');

  const credentials = {
    username: HMAC_CLIENT_ID,
    algorithm: 'hmac-sha256',
    headers,
    signature,
  };

  return `HMAC ${JSON.stringify(credentials)}`;
}

/**
 * Represents an authenticated test context with user and token
 */
export interface TestContext {
  userId: string;
  email: string;
  accessToken: string;
}

// ============================================
// GraphQL Request Functions
// ============================================

/**
 * Makes a GraphQL request through the API Gateway.
 * Handles CSRF token automatically using double-submit cookie pattern.
 *
 * This is the primary function for integration tests - it tests the full
 * request path through the gateway, including federation.
 */
export async function graphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  // Get CSRF token for the request
  const csrf = await getCsrfToken();

  const response = await fetch(`${API_GATEWAY_URL}${API_GATEWAY_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: csrf.cookie,
      'x-csrf-token': csrf.token,
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });

  // If we get a CSRF error, clear token and retry once
  if (response.status === 403) {
    const errorBody = await response.json();
    if (errorBody.message?.includes('CSRF')) {
      clearCsrfToken();
      const newCsrf = await getCsrfToken();
      const retryResponse = await fetch(
        `${API_GATEWAY_URL}${API_GATEWAY_PATH}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: newCsrf.cookie,
            'x-csrf-token': newCsrf.token,
            ...headers,
          },
          body: JSON.stringify({ query, variables }),
        },
      );
      return retryResponse.json();
    }
    return errorBody;
  }

  return response.json();
}

/**
 * Makes an authenticated GraphQL request through the API Gateway.
 * Includes both CSRF token and JWT bearer token.
 */
export async function authenticatedGraphqlRequest<T = unknown>(
  query: string,
  variables: Record<string, unknown> | undefined,
  accessToken: string,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  return graphqlRequest<T>(query, variables, {
    Authorization: `Bearer ${accessToken}`,
  });
}

/**
 * Mint an HS256 JWT for an admin user, suitable for hitting resolvers
 * gated by `@Roles(Role.Admin)`. Matches the payload shape that the
 * backend's `JwtStrategy.validate()` expects (sub / email /
 * app_metadata.roles).
 *
 * Reads `AUTH_JWT_SECRET` from process.env — the same value the running
 * backend services were started with. In docker-compose-e2e.yml that's
 * the well-known dev secret; in local dev it's whatever's in
 * apps/backend/.env. If the env var is missing, throws so the test
 * fails loudly rather than producing an invalid token.
 *
 * Returns the bearer token string. Pass to `authenticatedGraphqlRequest`.
 */
export function signAdminJwt(
  options: { userId?: string; email?: string } = {},
): string {
  // Lazy-require so non-auth-using tests don't pay the import cost.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_JWT_SECRET is not set; cannot sign an admin JWT for the test. ' +
        'Ensure docker-compose-e2e.yml or apps/backend/.env provides it.',
    );
  }
  const payload = {
    sub: options.userId ?? 'integration-test-admin',
    email: options.email ?? 'admin@opuspopuli.local',
    app_metadata: { roles: ['admin'] },
    user_metadata: { department: '', clearance: '' },
  };
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

/**
 * Convenience wrapper for admin-only mutations: signs a fresh admin JWT
 * and routes through `authenticatedGraphqlRequest`. Use for `@Roles(Role.Admin)`
 * resolvers like `updateRegionPlugin`, `refreshActiveRegion`,
 * `invalidateManifest`, `syncRegionData`.
 */
export async function adminGraphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  return authenticatedGraphqlRequest<T>(query, variables, signAdminJwt());
}

/**
 * Makes a GraphQL request directly to a microservice (bypasses API Gateway).
 * Uses HMAC authentication. Useful for debugging or isolated service testing.
 *
 * @deprecated Prefer graphqlRequest() which goes through the API Gateway
 */
export async function directServiceRequest<T = unknown>(
  serviceUrl: string,
  query: string,
  variables?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const hmacHeader = generateHmacHeader('POST', '/graphql');

  const response = await fetch(`${serviceUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HMAC-Auth': hmacHeader,
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });

  return response.json();
}

/**
 * Creates a test user and authenticates via magic link.
 * Returns a TestContext with the access token for authenticated requests.
 *
 * Note: This is slower than createTestContextDirect but tests the full auth flow.
 *
 * @example
 * ```typescript
 * const ctx = await createTestContext();
 * const result = await authenticatedGraphqlRequest(
 *   SERVICE_URLS.users,
 *   `query { getUser(id: "${ctx.userId}") { id email } }`,
 *   undefined,
 *   ctx.accessToken,
 * );
 * ```
 */
export async function createTestContext(): Promise<TestContext> {
  const email = generateTestEmail();

  // Request magic link
  const response = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_ANON_KEY || '',
    },
    body: JSON.stringify({ email, create_user: true }),
  });

  if (!response.ok) {
    throw new Error(`Failed to request magic link: ${response.statusText}`);
  }

  // Wait for and retrieve the magic link
  let magicLink: string | null = null;
  await waitFor(async () => {
    magicLink = await getMagicLinkFromInbucket(email);
    return magicLink !== null;
  });

  if (!magicLink) {
    throw new Error('Magic link not received');
  }

  // Extract token and verify
  const link: string = magicLink;
  const tokenMatch = /token=([^&]+)/.exec(link);
  if (!tokenMatch) {
    throw new Error('Token not found in magic link');
  }

  // Verify the OTP token to get access token
  const verifyResponse = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_ANON_KEY || '',
    },
    body: JSON.stringify({
      type: 'magiclink',
      token: tokenMatch[1],
    }),
  });

  if (!verifyResponse.ok) {
    throw new Error(
      `Failed to verify magic link: ${verifyResponse.statusText}`,
    );
  }

  const authData = await verifyResponse.json();
  const accessToken = authData.access_token;
  const userId = authData.user?.id;

  if (!accessToken || !userId) {
    throw new Error('Failed to get access token or user ID');
  }

  // Clean up mailbox
  await clearInbucketMailbox(email);

  return { userId, email, accessToken };
}

/**
 * Creates a test context directly in the database without going through auth.
 * Much faster than createTestContext, but doesn't test auth flow.
 *
 * Note: The accessToken returned is a mock token that won't work with real auth guards.
 * Use this for tests that mock or bypass authentication.
 *
 * @example
 * ```typescript
 * const ctx = await createTestContextDirect();
 * // Use ctx.userId for database operations
 * // Note: ctx.accessToken is a placeholder, not a real JWT
 * ```
 */
export async function createTestContextDirect(): Promise<TestContext> {
  const email = generateEmail('direct');
  const user = await createUser({ email });

  // Return a mock token - tests using this should bypass auth guards
  return {
    userId: user.id,
    email: user.email,
    accessToken: `mock-token-${user.id}`,
  };
}

/**
 * Looks up a user in the database by email
 */
export async function findUserByEmail(email: string) {
  const db = await getDbService();
  return db.user.findFirst({ where: { email } });
}

/**
 * Looks up a user in the database by ID
 */
export async function findUserById(id: string) {
  const db = await getDbService();
  return db.user.findUnique({ where: { id } });
}

/**
 * Helper to assert GraphQL response has no errors
 */
export function assertNoErrors<T>(result: {
  data?: T;
  errors?: Array<{ message: string }>;
}): asserts result is { data: T } {
  if (result.errors && result.errors.length > 0) {
    throw new Error(
      `GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`,
    );
  }
}

/**
 * Helper to assert GraphQL response has expected error
 */
export function assertHasError(
  result: { errors?: Array<{ message: string }> },
  expectedMessage: string | RegExp,
): void {
  if (!result.errors || result.errors.length === 0) {
    throw new Error(
      `Expected error matching "${expectedMessage}" but got no errors`,
    );
  }

  const hasMatch = result.errors.some((e) =>
    typeof expectedMessage === 'string'
      ? e.message.includes(expectedMessage)
      : expectedMessage.test(e.message),
  );

  if (!hasMatch) {
    throw new Error(
      `Expected error matching "${expectedMessage}" but got: ${result.errors.map((e) => e.message).join(', ')}`,
    );
  }
}

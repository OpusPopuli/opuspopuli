/**
 * Server-side reads of the public civic record, for the sitemap and each
 * page's metadata (#1456).
 *
 * These run on the Cloudflare Worker while a crawler or link preview waits,
 * so they are:
 * - GET queries, which Cloudflare's edge cache can hold (`cf.cacheTtl`;
 *   Next's own fetch cache is a no-op on the Worker, see lib/prompt-record);
 * - bounded by a timeout, and never thrown: a slow or failed read returns
 *   null, and the caller falls back to generic metadata or a shorter sitemap;
 * - signed, when the Worker holds `EDGE_READ_SIGNING_SECRET`, so the gateway
 *   counts them against their own budget rather than the one address every
 *   Cloudflare Worker shares. The gateway checks the same scheme
 *   (`common/rate-limit/edge-read-signature.ts`); both test suites share a
 *   vector.
 *
 * The secret is a Worker secret (`wrangler secret put`), never a `.env`
 * entry: OpenNext embeds `.env` files in the bundle (scripts/check-worker-env).
 * Unset, reads go out unsigned and are limited like any client.
 */

export const EDGE_READ_HEADER = "x-op-edge-read";

/** Matches the gateway's minimum; shorter is treated as not configured. */
const MIN_SECRET_LENGTH = 32;

const DEFAULT_TIMEOUT_MS = 3_000;

function graphqlUrl(): string {
  return process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api";
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** `<unix seconds>.<hex HMAC-SHA256 of "<seconds>\n<path and query>">`. */
export async function signEdgeRead(
  secret: string,
  pathAndQuery: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}\n${pathAndQuery}`),
  );
  return `${timestamp}.${hex(mac)}`;
}

export interface EdgeReadOptions {
  /** Seconds the edge may serve a copy. */
  readonly ttl: number;
  readonly timeoutMs?: number;
  /** For tests. */
  readonly fetchImpl?: typeof fetch;
  readonly secret?: string;
  readonly endpoint?: string;
}

/**
 * Run one public GraphQL query as a cacheable GET. Returns its `data`, or
 * null on any failure: an error, a timeout, a 429, a GraphQL error.
 */
export async function edgeQuery<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  options: EdgeReadOptions,
): Promise<T | null> {
  const url = new URL(options.endpoint ?? graphqlUrl());
  url.searchParams.set("query", query);
  if (variables) url.searchParams.set("variables", JSON.stringify(variables));

  // Apollo's CSRF prevention refuses a GET without a preflight-forcing header.
  const headers: Record<string, string> = {
    "apollo-require-preflight": "true",
  };
  const secret = options.secret ?? process.env.EDGE_READ_SIGNING_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) {
    headers[EDGE_READ_HEADER] = await signEdgeRead(
      secret,
      url.pathname + url.search,
    );
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: "GET",
      headers,
      next: { revalidate: options.ttl },
      cf: { cacheTtl: options.ttl, cacheEverything: true },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    } as RequestInit);
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: T; errors?: unknown[] };
    if (body.errors?.length) return null;
    return body.data ?? null;
  } catch {
    return null;
  }
}

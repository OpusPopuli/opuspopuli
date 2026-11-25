import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A read the frontend's Cloudflare Worker makes on a reader's behalf (#1456).
 *
 * The Worker renders the sitemap and every page's metadata server-side, and
 * all of its requests reach us from Cloudflare's shared Worker address. Keyed
 * on that address, they would share one visitor's budget: a crawl would spend
 * it in seconds and every page would be indexed with generic metadata. An
 * allowlist of the address is no answer, because every Cloudflare customer's
 * Worker uses it.
 *
 * So the Worker signs each read with a secret only it and the gateway hold,
 * and a signed read gets its own budget (larger, still capped). The signature
 * covers the request's path and query, so a copied header buys nothing but
 * the one read it was made for, and only for {@link EDGE_READ_MAX_SKEW_MS}.
 *
 * The frontend's `lib/server/edge-read.ts` signs with the same scheme; both
 * test suites check the same vector.
 */
export const EDGE_READ_HEADER = 'x-op-edge-read';

/** How old (or how far ahead) a signature may be and still count. */
export const EDGE_READ_MAX_SKEW_MS = 5 * 60_000;

/** The secret's minimum length; shorter is treated as not configured. */
export const EDGE_READ_MIN_SECRET_LENGTH = 32;

function mac(secret: string, timestamp: string, pathAndQuery: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${pathAndQuery}`)
    .digest('hex');
}

/** `<unix seconds>.<hex HMAC-SHA256 of "<seconds>\n<path and query>">`. */
export function signEdgeRead(
  secret: string,
  pathAndQuery: string,
  nowMs: number = Date.now(),
): string {
  const timestamp = String(Math.floor(nowMs / 1000));
  return `${timestamp}.${mac(secret, timestamp, pathAndQuery)}`;
}

/**
 * Whether `header` is a fresh signature of this exact path and query. False
 * for anything malformed, stale, or signed with another secret, and always
 * false when no usable secret is configured.
 */
export function verifyEdgeRead(
  header: string | string[] | undefined,
  secret: string | undefined,
  pathAndQuery: string,
  nowMs: number = Date.now(),
): boolean {
  if (!secret || secret.length < EDGE_READ_MIN_SECRET_LENGTH) return false;
  if (typeof header !== 'string') return false;

  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const [, timestamp, given] = match;

  if (Math.abs(nowMs - Number(timestamp) * 1000) > EDGE_READ_MAX_SKEW_MS) {
    return false;
  }

  const expected = Buffer.from(mac(secret, timestamp, pathAndQuery), 'hex');
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

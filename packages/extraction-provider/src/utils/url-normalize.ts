/**
 * Canonicalize a URL via the WHATWG URL parser. Notable effects:
 * - bare-domain inputs gain a trailing slash (`https://x.com` → `https://x.com/`)
 * - default ports are elided
 * - hostname is lowercased
 *
 * Used at fetch entry points so we (a) request the canonical form and avoid
 * the 301 round-trip, and (b) compare apples-to-apples when detecting
 * redirects against `Response.url`. Falls through unchanged if the input
 * isn't a parseable URL — callers downstream will surface the failure.
 */
export function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

/**
 * Query-string redaction for outgoing HTTP spans (#1456).
 *
 * The undici and http auto-instrumentations record every outgoing request's
 * full URL, query string included, on the span (`url.full`, `url.query`,
 * `http.url`). The geocoder sends a street address as query parameters:
 * `?street=…&city=…&zip=…`. So every address lookup, signed-in or not, was
 * written to the trace store, alongside a server span carrying the client's
 * IP. Found by review on UAT, in a Tempo trace of `locateJurisdictions`.
 *
 * The fix is general rather than geocoder-shaped: every query value on every
 * outgoing span is replaced. A parameter's name says what kind of request it
 * was; its value is where personal data lives, and a span is no place for
 * it. A list of known-sensitive names would be exactly as safe as its next
 * omission.
 */

export const REDACTED = 'REDACTED';

/** `?a=1&b=two` → `?a=REDACTED&b=REDACTED`; names kept, values gone. */
export function redactQueryString(search: string): string {
  if (!search || search === '?') return search;
  const body = search.startsWith('?') ? search.slice(1) : search;
  const redacted = body
    .split('&')
    .map((pair) => {
      const name = pair.split('=')[0];
      return pair.includes('=') ? `${name}=${REDACTED}` : name;
    })
    .join('&');
  return `?${redacted}`;
}

/** A URL with every query value redacted and any fragment dropped. */
export function redactUrl(url: string): string {
  const queryAt = url.indexOf('?');
  if (queryAt === -1) return url;
  const hashAt = url.indexOf('#', queryAt);
  const search =
    hashAt === -1 ? url.slice(queryAt) : url.slice(queryAt, hashAt);
  return url.slice(0, queryAt) + redactQueryString(search);
}

/** The parts of an undici request the hook reads. */
interface UndiciRequestLike {
  origin: string | URL;
  path: string;
}

/**
 * `startSpanHook` for `@opentelemetry/instrumentation-undici`. Its returned
 * attributes overwrite the instrumentation's own before the span starts, so
 * the raw URL is never recorded at all.
 */
export function undiciStartSpanHook(
  request: UndiciRequestLike,
): Record<string, string> {
  const url = `${String(request.origin)}${request.path}`;
  const queryAt = request.path.indexOf('?');
  return {
    'url.full': redactUrl(url),
    'url.query':
      queryAt === -1 ? '' : redactQueryString(request.path.slice(queryAt)),
  };
}

/** The parts of node:http request options the hook reads. */
interface HttpRequestOptionsLike {
  protocol?: string | null;
  hostname?: string | null;
  host?: string | null;
  port?: string | number | null;
  path?: string | null;
}

/**
 * `startOutgoingSpanHook` for `@opentelemetry/instrumentation-http`. Its
 * attributes are merged last, over the instrumentation's own, so both the
 * stable (`url.full`) and the older (`http.url`, `http.target`) names are
 * overwritten.
 */
export function httpStartOutgoingSpanHook(
  options: HttpRequestOptionsLike,
): Record<string, string> {
  const host = options.hostname ?? options.host ?? 'localhost';
  const port = options.port ? `:${options.port}` : '';
  const path = redactUrl(options.path ?? '/');
  const url = `${options.protocol ?? 'http:'}//${host}${port}${path}`;
  // `http.target` is the older conventions' path plus query string.
  return { 'url.full': url, 'http.url': url, 'http.target': path };
}

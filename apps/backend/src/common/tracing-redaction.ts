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

/**
 * `?a=1&b=two&flag` → `?a=REDACTED&b=REDACTED&REDACTED`. Names are kept and
 * values go. A token with no `=` is redacted whole: `?38.5767,-121.4934` is a
 * value with no name, and nothing tells the two apart (#1460).
 */
export function redactQueryString(search: string): string {
  if (!search || search === '?') return search;
  const body = search.startsWith('?') ? search.slice(1) : search;
  const redacted = body
    .split('&')
    .map((pair) => {
      const name = pair.split('=')[0];
      return pair.includes('=') ? `${name}=${REDACTED}` : REDACTED;
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

/**
 * `192.0.2.7` → `192.x.x.x`; anything else → `[REDACTED_IP]`. The same output
 * as `maskIpAddress` in `utils/pii-masker`, kept here because this module
 * loads before the tracing SDK starts, and that one imports a workspace
 * package that must not load first.
 */
export function maskClientIp(ip: string): string {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.x.x.x` : '[REDACTED_IP]';
}

/** The parts of a node:http IncomingMessage the hook reads. */
interface IncomingRequestLike {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** A TLS socket has `encrypted: true`; a plain one has no such field. */
  socket?: object | null;
}

function isTls(socket: object | null | undefined): boolean {
  return !!socket && 'encrypted' in socket && socket.encrypted === true;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The first hop of `X-Forwarded-For`, which `http.client_ip` records. */
function firstForwardedFor(
  headers: IncomingRequestLike['headers'],
): string | undefined {
  const value = firstHeader(headers['x-forwarded-for']);
  return value ? value.split(',')[0].trim() : undefined;
}

/**
 * The address the stable `client.address` records: the first `for=` of a
 * `Forwarded` header, else the first `X-Forwarded-For` hop. The same order
 * the instrumentation uses. Only masked, so the exact parse matters less than
 * finding every source it reads.
 */
function forwardedClientAddress(
  headers: IncomingRequestLike['headers'],
): string | undefined {
  const forwarded = firstHeader(headers.forwarded);
  const match = forwarded ? /for="?\[?([^\]";,\s]+)/i.exec(forwarded) : null;
  return match?.[1] ?? firstForwardedFor(headers);
}

/**
 * `startIncomingSpanHook` for `@opentelemetry/instrumentation-http` (#1460).
 * Its attributes are merged last, over the instrumentation's own.
 *
 * - **Query values.** An incoming span records the full URL, so a GET with
 *   variables in its query string put them in the trace store, even when the
 *   request was refused. Shown on prod: a GET of `locateJurisdictions` with
 *   coordinates inline was answered 405 and the coordinates were traced.
 * - **Client IP.** `http.client_ip` is the first `X-Forwarded-For` hop: behind
 *   the tunnel, the visitor's IP. The stable `client.address` reads a
 *   `Forwarded` header first. Both are masked like every IP this codebase
 *   logs.
 *
 * Only attributes the request gives a value for are returned, so a span
 * without a query string or a forwarded address keeps what the
 * instrumentation recorded. The service runs the older conventions (no
 * `OTEL_SEMCONV_STABILITY_OPT_IN`); the stable names are set as well so that
 * opting in later doesn't reopen this. On the older conventions that adds a
 * redacted `url.query` and a masked `client.address` the span wouldn't
 * otherwise carry.
 */
export function httpStartIncomingSpanHook(
  request: IncomingRequestLike,
): Record<string, string> {
  const attributes: Record<string, string> = {};

  const target = request.url ?? '/';
  const queryAt = target.indexOf('?');
  if (queryAt !== -1) {
    const redactedTarget = redactUrl(target);
    const scheme = isTls(request.socket) ? 'https' : 'http';
    const host = firstHeader(request.headers.host);
    attributes['http.target'] = redactedTarget;
    attributes['http.url'] = host
      ? `${scheme}://${host}${redactedTarget}`
      : redactedTarget;
    attributes['url.query'] = redactQueryString(target.slice(queryAt)).slice(1);
  }

  const firstHop = firstForwardedFor(request.headers);
  if (firstHop) attributes['http.client_ip'] = maskClientIp(firstHop);
  const clientAddress = forwardedClientAddress(request.headers);
  if (clientAddress) attributes['client.address'] = maskClientIp(clientAddress);

  return attributes;
}

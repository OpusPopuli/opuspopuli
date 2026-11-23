import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Cloudflare sets this on every request it proxies, overwriting any value
 * the visitor sent, so behind Cloudflare it cannot be forged (#1456).
 */
export const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

/**
 * Peers whose proxy headers we believe: loopback and private networks.
 * In production the gateway's peer is the `cloudflared` container on the
 * Docker network, and a subgraph's peer is the gateway. A request arriving
 * from a public address reached us without a proxy we run, so whatever
 * forwarding headers it carries are its own invention.
 */
const TRUSTED_PEERS = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
] as const) {
  TRUSTED_PEERS.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  TRUSTED_PEERS.addSubnet(network, prefix, 'ipv6');
}

/** `::ffff:10.0.0.1` → `10.0.0.1`: Node reports IPv4 peers this way on dual-stack sockets. */
function unmapped(ip: string): string {
  return ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4
    ? ip.slice(7)
    : ip;
}

/** A syntactically valid IP, normalised, or undefined. */
function validIp(value: string | undefined): string | undefined {
  const ip = value?.trim();
  if (!ip) return undefined;
  const plain = unmapped(ip);
  return isIP(plain) ? plain : undefined;
}

function isTrustedPeer(socketIp: string | undefined): boolean {
  const ip = validIp(socketIp);
  if (!ip) return false;
  return TRUSTED_PEERS.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

function headerValue(
  headers: IncomingHttpHeaders | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value.join(',') : value;
}

/**
 * The client's IP, for rate limits, per-IP caps and audit records (#1456).
 *
 * Forwarding headers are believed only when the request came from a proxy
 * we run (a private or loopback peer). Then, most trustworthy first:
 *
 * 1. `cf-connecting-ip`, which Cloudflare sets and the visitor cannot.
 * 2. The **last** `x-forwarded-for` hop: the one our nearest proxy appended.
 *    Never the first. The first hop is whatever the client chose to send,
 *    and keying limits on it let anyone reset their own rate limit by
 *    sending a new header on every request.
 *
 * Otherwise, and as the fallback, the socket address.
 *
 * In a subgraph, `x-forwarded-for` holds exactly one value, set by the
 * gateway from this same function (the gateway forwards no browser
 * headers), and the peer is the gateway, so the same rule gives the same
 * answer there.
 */
export function resolveClientIp(
  headers: IncomingHttpHeaders | undefined,
  socketIp?: string,
): string | undefined {
  const socket = validIp(socketIp);
  // No socket address at all happens only in-process (tests, mocks), where
  // there is no network peer to distrust.
  if (socket === undefined || isTrustedPeer(socket)) {
    const fromCloudflare = validIp(
      headerValue(headers, CF_CONNECTING_IP_HEADER)?.split(',')[0],
    );
    if (fromCloudflare) return fromCloudflare;

    const hops = headerValue(headers, 'x-forwarded-for')?.split(',') ?? [];
    const lastHop = validIp(hops.at(-1));
    if (lastHop) return lastHop;
  }
  return socket;
}

/**
 * The key a rate limit counts against for a client IP (#1456).
 *
 * An IPv4 address as is. An IPv6 address by its prefix: a home line or a
 * cheap server is handed a whole /64, so per-address keys would give one
 * client 2^64 separate budgets. /64 by default. Pass 48 where one
 * subscriber's many /64s must not add up to a shared resource: a /56 home
 * allocation holds 256 of them.
 */
export function rateLimitKey(
  ip: string | undefined,
  ipv6Prefix: 48 | 64 = 64,
): string {
  const valid = validIp(ip);
  if (!valid) return 'unknown';
  if (isIP(valid) === 4) return valid;
  const groups = ipv6Prefix / 16;
  return `${expandIpv6(valid).slice(0, groups).join(':')}::/${ipv6Prefix}`;
}

/** The eight 16-bit groups of an IPv6 address, `::` expanded. */
function expandIpv6(ip: string): string[] {
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // An embedded IPv4 tail (`::ffff:1.2.3.4`) is two groups.
  const lastRight = right.at(-1);
  if (lastRight?.includes('.')) {
    const [a, b, c, d] = lastRight.split('.').map(Number);
    right.splice(
      -1,
      1,
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16),
    );
  }
  const fill = ip.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...new Array(fill).fill('0'), ...right].map((group) =>
    group.toLowerCase().replace(/^0+(?=.)/, ''),
  );
}

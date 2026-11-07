import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { readCookie } from './cookie.utils';

/**
 * Header the gateway sets for subgraphs: an opaque id for the reader's
 * browser, for per-reader caps on anonymous requests (bills-phase-b.md,
 * D18). Set only by the gateway, like `user`; subgraphs accept only
 * HMAC-signed gateway requests, and the gateway does not pass a browser's
 * own headers through.
 */
export const CLIENT_SESSION_HEADER = 'x-client-session';

/**
 * The reader's session id: sha256 of the CSRF cookie, which is stable per
 * browser for a day and already required on every mutation (double submit).
 * The hash, never the token: the token is a secret the subgraphs never need.
 */
export function clientSessionId(
  req: Request,
  cookieName: string = process.env.CSRF_COOKIE_NAME || 'csrf-token',
): string | undefined {
  const token = readCookie(req, cookieName);
  return token
    ? createHash('sha256').update(token, 'utf8').digest('hex')
    : undefined;
}

/** The session id a subgraph received from the gateway, if any. */
export function readClientSession(
  headers: IncomingHttpHeaders | undefined,
): string | undefined {
  const value = headers?.[CLIENT_SESSION_HEADER];
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[0-9a-f]{64}$/.test(id) ? id : undefined;
}

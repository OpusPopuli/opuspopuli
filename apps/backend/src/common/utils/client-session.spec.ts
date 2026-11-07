import type { Request } from 'express';
import {
  CLIENT_SESSION_HEADER,
  clientSessionId,
  readClientSession,
} from './client-session';

const req = (over: Partial<Request>) =>
  ({ headers: {}, ...over }) as unknown as Request;

describe('clientSessionId (bills-phase-b.md, D18)', () => {
  it('is the sha256 of the CSRF cookie, never the token', () => {
    const id = clientSessionId(req({ cookies: { 'csrf-token': 'tok-1' } }));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('tok-1');
    expect(clientSessionId(req({ cookies: { 'csrf-token': 'tok-1' } }))).toBe(
      id,
    );
    expect(
      clientSessionId(req({ cookies: { 'csrf-token': 'tok-2' } })),
    ).not.toBe(id);
  });

  it('reads the raw Cookie header when cookie-parser did not run', () => {
    expect(
      clientSessionId(req({ headers: { cookie: 'a=1; csrf-token=tok-1' } })),
    ).toBe(clientSessionId(req({ cookies: { 'csrf-token': 'tok-1' } })));
  });

  it('is undefined with no CSRF cookie', () => {
    expect(clientSessionId(req({ headers: {} }))).toBeUndefined();
  });
});

describe('readClientSession', () => {
  it('accepts only a sha256 hex id', () => {
    const id = 'a'.repeat(64);
    expect(readClientSession({ [CLIENT_SESSION_HEADER]: id })).toBe(id);
    expect(readClientSession({ [CLIENT_SESSION_HEADER]: 'raw-token' })).toBe(
      undefined,
    );
    expect(readClientSession(undefined)).toBeUndefined();
  });
});

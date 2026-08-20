import { resolveRequestUser } from './request-user';
import { ILogin } from 'src/interfaces/login.interface';

/**
 * The production incident these pin: PoliciesGuard read only `request.user`,
 * which on subgraph requests is populated by the route-level AuthGuard —
 * which runs AFTER global guards. So every `@Permissions` resolver denied
 * every caller, the whole petition surface returned `Forbidden resource` to
 * signed-in users, and the frontend classified that as an expired session and
 * logged them out. Clicking "Petition" in the nav kicked you out of the app.
 */
describe('resolveRequestUser', () => {
  const USER: ILogin = {
    id: 'u-1',
    email: 'user@example.test',
    roles: [],
    department: '',
    clearance: '',
  };

  const req = (over: Record<string, unknown> = {}) =>
    ({ headers: {}, ...over }) as Parameters<typeof resolveRequestUser>[0];

  it('returns request.user when Passport already validated it', () => {
    expect(resolveRequestUser(req({ user: USER }))).toEqual(USER);
  });

  it('falls back to the forwarded header ONLY alongside an HMAC signature', () => {
    // The gateway path: HMACMiddleware verified the signature before any
    // guard ran, so the forwarded identity is trustworthy.
    const r = req({
      headers: { 'x-hmac-auth': 'sig', user: JSON.stringify(USER) },
    });

    expect(resolveRequestUser(r)).toEqual(USER);
    // Attached for downstream guards and resolvers — one parse, one identity.
    expect(r!.user).toEqual(USER);
  });

  it('never trusts a user header WITHOUT the HMAC signature', () => {
    // A client hitting a subgraph directly could set this header; without
    // the signature it must be worthless. (#183)
    const r = req({ headers: { user: JSON.stringify(USER) } });

    expect(resolveRequestUser(r)).toBeUndefined();
  });

  it('rejects a forwarded header that is not a complete login shape', () => {
    const r = req({
      headers: {
        'x-hmac-auth': 'sig',
        user: JSON.stringify({ id: 'u-1' }), // missing email/roles/etc
      },
    });

    expect(resolveRequestUser(r)).toBeUndefined();
  });

  it('survives malformed JSON in the header', () => {
    const r = req({ headers: { 'x-hmac-auth': 'sig', user: '{not json' } });

    expect(resolveRequestUser(r)).toBeUndefined();
  });

  it('returns undefined for a missing request', () => {
    expect(resolveRequestUser(undefined)).toBeUndefined();
  });
});

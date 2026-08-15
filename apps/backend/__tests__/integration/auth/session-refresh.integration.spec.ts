/**
 * Session Refresh Integration Tests (#977)
 *
 * Covers the things unit tests structurally cannot:
 *
 * - that the renewal route is actually reachable at the path the refresh
 *   cookie is scoped to, through the real middleware chain
 * - that CSRF genuinely guards it — asserted here rather than inferred from
 *   the middleware wiring, which is all subtask 3 could do
 * - that the last-32 refresh-token fragment convention round-trips through a
 *   real Postgres column, which is what rotation and revocation both match on
 *
 * Requires the integration stack: `pnpm integration:up`.
 */
import {
  cleanDatabase,
  createUser,
  disconnectDatabase,
  getDbService,
} from '../utils';

const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const REFRESH_URL = `${GATEWAY_URL}/api/auth/refresh`;

/** Mirrors AuthResolver.createSession — the last 32 chars, never the whole JWT. */
const fragment = (token: string) => token.slice(-32);

async function getCsrfToken(): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /csrf-token=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('Gateway did not issue a csrf-token cookie');
  return match[1];
}

/** Set-Cookie directives that clear a cookie rather than set one. */
const clearsCookie = (setCookie: string, name: string) =>
  new RegExp(`${name}=;|${name}=;?\\s*Expires=Thu, 01 Jan 1970`, 'i').test(
    setCookie,
  );

describe('Session refresh (#977)', () => {
  let csrf: string;

  beforeAll(async () => {
    csrf = await getCsrfToken();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('CSRF protection', () => {
    // Deferred from subtask 3, where it could only be read off the middleware
    // wiring. The route inherits CsrfMiddleware via forRoutes({path:'*'});
    // this proves it.
    it('rejects a POST with no CSRF token', async () => {
      const response = await fetch(REFRESH_URL, { method: 'POST' });

      expect(response.status).toBe(403);
    });

    it('rejects a POST whose CSRF header does not match the cookie', async () => {
      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'not-the-right-token',
          Cookie: `csrf-token=${csrf}`,
        },
      });

      expect(response.status).toBe(403);
    });
  });

  describe('without a usable refresh cookie', () => {
    it('401s and clears both auth cookies when no refresh cookie is sent', async () => {
      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrf,
          Cookie: `csrf-token=${csrf}`,
        },
      });

      expect(response.status).toBe(401);

      // The browser must stop presenting a half-dead session.
      const setCookie = response.headers.get('set-cookie') || '';
      expect(clearsCookie(setCookie, 'access-token')).toBe(true);
      expect(clearsCookie(setCookie, 'refresh-token')).toBe(true);
    });

    it('401s on a refresh token the provider rejects', async () => {
      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrf,
          Cookie: `csrf-token=${csrf}; refresh-token=definitely-not-a-valid-grant`,
        },
      });

      // A rejected grant is terminal — 401, not 503.
      expect(response.status).toBe(401);
    });

    it('never returns tokens in the response body', async () => {
      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrf,
          Cookie: `csrf-token=${csrf}; refresh-token=definitely-not-a-valid-grant`,
        },
      });

      const body = await response.text();
      expect(body).not.toMatch(/accessToken|refreshToken|eyJ/);
    });
  });

  /**
   * The assumption rotation rests on, and the one I could only verify by
   * reading: `createSession` stores `refreshToken.slice(-32)`, and both
   * `rotateSession` and `revokeSessionByRefreshToken` match on that same
   * fragment. If the convention did not round-trip, rotation would silently
   * update zero rows and renewal would still LOOK like it worked.
   */
  describe('refresh-token fragment convention against a real database', () => {
    let db: Awaited<ReturnType<typeof getDbService>>;
    let userId: string;

    beforeAll(async () => {
      db = await getDbService();
    });

    beforeEach(async () => {
      await cleanDatabase();
      // Use the shared fixture rather than a hand-rolled insert, so this test
      // tracks the real User schema instead of a guess at it.
      const user = await createUser();
      userId = user.id;
    });

    // A GoTrue refresh token is far longer than the 32 chars stored.
    const longToken = `v1.${'a'.repeat(200)}.TAIL-THAT-IDENTIFIES-THE-SESSION`;

    const seedSession = () =>
      db.userSession.create({
        data: {
          userId,
          sessionToken: fragment('access-token-original-value-padding'),
          refreshToken: fragment(longToken),
          isActive: true,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

    it('matches the stored fragment when rotating', async () => {
      await seedSession();
      const renewedAccess = `new.${'b'.repeat(200)}.NEW-ACCESS-TAIL`;
      const renewedRefresh = `new.${'c'.repeat(200)}.NEW-REFRESH-TAIL`;

      const result = await db.userSession.updateMany({
        where: { refreshToken: fragment(longToken), isActive: true },
        data: {
          sessionToken: fragment(renewedAccess),
          refreshToken: fragment(renewedRefresh),
          lastActivityAt: new Date(),
        },
      });

      expect(result.count).toBe(1);

      const rotated = await db.userSession.findFirst({ where: { userId } });
      expect(rotated?.refreshToken).toBe(fragment(renewedRefresh));
      // Same session, not a new row — otherwise "your active sessions" becomes
      // a list of every 15-minute window since sign-in.
      expect(await db.userSession.count({ where: { userId } })).toBe(1);
    });

    it('matches the stored fragment when revoking a rejected grant', async () => {
      await seedSession();

      const result = await db.userSession.updateMany({
        where: { refreshToken: fragment(longToken), isActive: true },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'refresh_rejected',
        },
      });

      expect(result.count).toBe(1);

      const revoked = await db.userSession.findFirst({ where: { userId } });
      expect(revoked?.isActive).toBe(false);
      expect(revoked?.revokedReason).toBe('refresh_rejected');
    });

    it('does not touch an already-rotated session when an old token is replayed', async () => {
      await seedSession();
      const rotatedAway = `new.${'d'.repeat(200)}.ROTATED-AWAY-TAIL`;
      await db.userSession.updateMany({
        where: { refreshToken: fragment(longToken) },
        data: { refreshToken: fragment(rotatedAway) },
      });

      // Replaying the consumed token now matches nothing, which is why
      // revocation is documented as best-effort and GoTrue's own reuse
      // detection is the real defence.
      const result = await db.userSession.updateMany({
        where: { refreshToken: fragment(longToken), isActive: true },
        data: { isActive: false, revokedReason: 'refresh_rejected' },
      });

      expect(result.count).toBe(0);
      const untouched = await db.userSession.findFirst({ where: { userId } });
      expect(untouched?.isActive).toBe(true);
    });
  });
});

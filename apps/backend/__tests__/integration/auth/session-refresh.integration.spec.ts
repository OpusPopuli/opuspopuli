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
  clearInbucketMailbox,
  createUser,
  disconnectDatabase,
  generateTestEmail,
  getDbService,
  getMagicLinkFromInbucket,
  graphqlRequest,
  INBUCKET_URL,
  waitFor,
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

  /**
   * The happy path, against a REAL GoTrue refresh token.
   *
   * Everything else in this file — and every unit test in the series — proves
   * a failure path or mocks the Supabase client. Until this existed, the one
   * thing never executed was renewal actually SUCCEEDING: whether
   * `supabase.auth.refreshSession()` works when the client was constructed
   * from a service-role key with `persistSession: false`, which is how the
   * provider builds it.
   *
   * The session is obtained the way a browser gets one: request a magic link,
   * read it out of Inbucket, and follow GoTrue's /verify redirect, which comes
   * back as a 303 whose Location fragment carries the tokens.
   *
   * NOT via the verifyMagicLink mutation. That takes an OTP code, while the
   * link carries a token_hash, so it rejects both signup and magiclink tokens
   * from a real email. The app works because the callback page reads the hash
   * fragment instead — see the note at the end of this file.
   */
  describe('renewal against a real GoTrue session', () => {
    let db: Awaited<ReturnType<typeof getDbService>>;
    let inbucketUp = false;

    beforeAll(async () => {
      db = await getDbService();
      // Checked ONCE, loudly. Previously every failure inside the login helper
      // looked like missing infrastructure, so these tests reported green
      // while proving nothing — the exact failure mode this whole issue is
      // about. Now: infrastructure absent => skip; anything else => fail.
      inbucketUp = await fetch(`${INBUCKET_URL}/api/v1/mailbox/probe`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!inbucketUp) {
        console.warn(
          'Inbucket unreachable — real-session renewal tests will SKIP. ' +
            'Run `pnpm integration:up` to execute them.',
        );
      }
    });

    /**
     * Full magic-link login yielding a genuine GoTrue session.
     * Throws on any failure that is not "Inbucket is not running".
     */
    async function loginViaMagicLink(): Promise<{
      email: string;
      accessToken: string;
      refreshToken: string;
    }> {
      const email = generateTestEmail();
      await clearInbucketMailbox(email);

      const sent = await graphqlRequest<{ registerWithMagicLink: boolean }>(`
        mutation {
          registerWithMagicLink(input: {
            email: "${email}",
            redirectTo: "http://localhost:3000/auth/callback"
          })
        }
      `);
      expect(sent.data?.registerWithMagicLink).toBe(true);

      let verifyUrl: string | null = null;
      await waitFor(
        async () => {
          verifyUrl = await getMagicLinkFromInbucket(email);
          return verifyUrl !== null;
        },
        { timeoutMs: 20000, intervalMs: 1000 },
      );
      if (!verifyUrl)
        throw new Error(`No magic-link email arrived for ${email}`);

      // Follow the link the way a browser does, but stop at the redirect so we
      // can read the fragment GoTrue puts the tokens in.
      const verified = await fetch(verifyUrl, { redirect: 'manual' });
      const location = verified.headers.get('location') || '';
      const fragmentParams = new URLSearchParams(location.split('#')[1] || '');

      const accessToken = fragmentParams.get('access_token');
      const refreshToken = fragmentParams.get('refresh_token');
      if (!accessToken || !refreshToken) {
        throw new Error(
          `GoTrue /verify did not return tokens (status ${verified.status})`,
        );
      }

      // Hand the session to our backend, exactly as /auth/callback does with
      // the hash fragment. This is what creates the UserSession row — without
      // it the tokens are valid but the app has never seen the login, and
      // rotation would have no row to update.
      const exchanged = await graphqlRequest<{
        exchangeSupabaseSession: { accessToken: string };
      }>(`
        mutation {
          exchangeSupabaseSession(input: {
            accessToken: "${accessToken}",
            refreshToken: "${refreshToken}"
          }) { accessToken }
        }
      `);
      if (!exchanged.data?.exchangeSupabaseSession) {
        throw new Error('Backend rejected the GoTrue session exchange');
      }

      return { email, accessToken, refreshToken };
    }

    const renew = (refreshToken: string) =>
      fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrf,
          Cookie: `csrf-token=${csrf}; refresh-token=${refreshToken}`,
        },
      });

    it('renews a real session: 204, no body, rotated tokens', async () => {
      if (!inbucketUp) return;
      const session = await loginViaMagicLink();

      const response = await renew(session.refreshToken);

      // The assertion nothing else in this series makes: renewal SUCCEEDING
      // against a real provider.
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');

      const setCookie = response.headers.get('set-cookie') || '';
      const newAccess = /access-token=([^;]+)/.exec(setCookie)?.[1];
      const newRefresh = /refresh-token=([^;]+)/.exec(setCookie)?.[1];

      expect(newAccess).toBeTruthy();
      expect(newRefresh).toBeTruthy();

      // GoTrue rotates the REFRESH token. Handing back the same one would
      // break every caller exactly one renewal later, and look fine until
      // then — so this is the assertion that matters.
      expect(newRefresh).not.toBe(session.refreshToken);

      // The access token is deliberately NOT asserted to differ. A JWT minted
      // in the same second as the original carries identical claims, so it is
      // byte-identical — which is what happens here, renewing milliseconds
      // after login, and never in real use. What matters is that a fresh
      // access cookie was issued with a full lifetime.
      expect(setCookie).toMatch(/access-token=[^;]+;.*Max-Age=9\d\d/);

      // The renewed cookies must keep their scopes, or the next renewal
      // silently cannot happen.
      expect(setCookie).toContain('Path=/api/auth/refresh');
      expect(setCookie).toContain('HttpOnly');
    }, 45000);

    it('rotates the UserSession row rather than adding one', async () => {
      if (!inbucketUp) return;
      const session = await loginViaMagicLink();

      const user = await db.user.findFirst({ where: { email: session.email } });
      if (!user) throw new Error('Magic-link login did not create an app user');

      const before = await db.userSession.count({ where: { userId: user.id } });

      expect((await renew(session.refreshToken)).status).toBe(204);

      // Session bookkeeping is fire-and-forget, so let the write land.
      await waitFor(
        async () => {
          const row = await db.userSession.findFirst({
            where: { userId: user.id },
          });
          return !!row && row.refreshToken !== fragment(session.refreshToken);
        },
        { timeoutMs: 10000, intervalMs: 500 },
      );

      const after = await db.userSession.count({ where: { userId: user.id } });
      expect(after).toBe(before);
    }, 45000);

    it('keeps renewing — a renewed token can itself be renewed', async () => {
      if (!inbucketUp) return;
      const session = await loginViaMagicLink();

      const first = await renew(session.refreshToken);
      expect(first.status).toBe(204);
      const rotated = /refresh-token=([^;]+)/.exec(
        first.headers.get('set-cookie') || '',
      )?.[1];
      expect(rotated).toBeTruthy();

      // The point of the whole change: a session stays alive indefinitely, not
      // for exactly one renewal. A latch that never released, or a rotation
      // that was not persisted, would fail here and nowhere else.
      const second = await renew(rotated!);
      expect(second.status).toBe(204);
    }, 60000);
  });
});

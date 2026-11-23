import 'reflect-metadata';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { THROTTLER_CONFIG } from 'src/common/config/shared-app.config';
import { AuthResolver } from 'src/apps/users/src/domains/auth/auth.resolver';
import {
  AUTH_THROTTLE,
  AUTH_THROTTLE_TIER,
  authThrottle,
} from './auth-throttle.config';

/**
 * The auth limits must name a throttler the module registers, or the guard
 * ignores them (#1456). They said `default` for their whole life, and no
 * auth route was ever limited beyond the backstop tiers.
 */
describe('authThrottle (#1456)', () => {
  const registered = THROTTLER_CONFIG.map((tier) => tier.name);

  it('overrides a tier every service registers', () => {
    expect(registered).toContain(AUTH_THROTTLE_TIER);
    expect(authThrottle(AUTH_THROTTLE.login)).toEqual({
      [AUTH_THROTTLE_TIER]: { ttl: 60000, limit: 5 },
    });
  });

  it.each([
    ['loginUser', AUTH_THROTTLE.login],
    ['registerUser', AUTH_THROTTLE.register],
  ])('puts %s under a name the guard reads', (handler, expected) => {
    const method = (
      AuthResolver.prototype as unknown as Record<string, object>
    )[handler];
    expect(method).toBeDefined();
    expect(
      Reflect.getMetadata(THROTTLER_LIMIT + AUTH_THROTTLE_TIER, method),
    ).toBe(expected.limit);
    expect(
      Reflect.getMetadata(THROTTLER_TTL + AUTH_THROTTLE_TIER, method),
    ).toBe(expected.ttl);
    expect(
      Reflect.getMetadata(THROTTLER_LIMIT + 'default', method),
    ).toBeUndefined();
  });

  it('leaves no @Throttle keyed on a name nothing registers', () => {
    const names = new Set<string>();
    for (const key of Object.getOwnPropertyNames(AuthResolver.prototype)) {
      const method = (
        AuthResolver.prototype as unknown as Record<string, object>
      )[key];
      if (typeof method !== 'function') continue;
      for (const metaKey of Reflect.getMetadataKeys(method) as string[]) {
        if (
          typeof metaKey === 'string' &&
          metaKey.startsWith(THROTTLER_LIMIT)
        ) {
          names.add(metaKey.slice(THROTTLER_LIMIT.length));
        }
      }
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(registered).toContain(name);
  });
});

import webauthnConfig from './webauthn.config';

/**
 * Regression tests for the missing `webauthn` namespace (#189 follow-up).
 *
 * `PasskeyService` had a thorough spec that passed throughout — because it
 * mocks `ConfigService` and hands back `webauthn.rpId` / `webauthn.origin`
 * directly. It verified the service's behaviour GIVEN the config, and nothing
 * verified the config existed. It did not: no `registerAs('webauthn')` was ever
 * written, so every lookup returned undefined and passkeys could not start in
 * production at all.
 *
 * These tests cover the seam the service spec cannot see — that the namespace
 * exists and reads the environment variables its error messages name.
 */
describe('webauthn.config', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('registers under the namespace PasskeyService reads', () => {
    // `configService.get('webauthn.rpId')` resolves only if the factory is
    // registered as exactly 'webauthn'. A rename on either side silently
    // reintroduces the original bug.
    expect(webauthnConfig.KEY).toBe('CONFIGURATION(webauthn)');
  });

  it('maps WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN from the environment', () => {
    process.env.WEBAUTHN_RP_ID = 'opuspopuli.org';
    process.env.WEBAUTHN_ORIGIN = 'https://app-us-ca.opuspopuli.org';

    const config = webauthnConfig();

    expect(config.rpId).toBe('opuspopuli.org');
    expect(config.origin).toBe('https://app-us-ca.opuspopuli.org');
  });

  it('leaves rpId and origin undefined when unset, rather than defaulting', () => {
    // Deliberate: PasskeyService owns the localhost fallback, and it must be
    // able to tell "not configured" from "configured as localhost" to decide
    // whether to throw in production. Defaulting here would silently disarm
    // that check and let a misconfigured production node boot with a passkey
    // relying party of 'localhost'.
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGIN;

    const config = webauthnConfig();

    expect(config.rpId).toBeUndefined();
    expect(config.origin).toBeUndefined();
  });

  it('defaults rpName, which is cosmetic and never gates startup', () => {
    delete process.env.WEBAUTHN_RP_NAME;
    expect(webauthnConfig().rpName).toBe('Opus Populi');

    process.env.WEBAUTHN_RP_NAME = 'Custom Name';
    expect(webauthnConfig().rpName).toBe('Custom Name');
  });
});

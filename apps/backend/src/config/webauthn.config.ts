import { registerAs } from '@nestjs/config';

/**
 * WebAuthn (passkey) configuration.
 *
 * `PasskeyService` has read `webauthn.rpId`, `webauthn.origin` and
 * `webauthn.rpName` since it was written, but **nothing ever registered the
 * namespace** — no `registerAs('webauthn')` existed anywhere in the backend,
 * and `WEBAUTHN_RP_ID` appeared in the codebase only inside the error message
 * complaining that it was missing.
 *
 * So every lookup returned `undefined` regardless of the environment, and
 * passkeys could never work in production: `PasskeyService` throws
 * unconditionally when `NODE_ENV=production`, naming an environment variable
 * that nothing read.
 *
 * It stayed hidden because the same check is only a warning outside
 * production. The us-ca node ran in development mode until 2026-08-13, and the
 * users service crash-looped the moment it was switched over.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/189
 */
export default registerAs('webauthn', () => ({
  /**
   * Relying Party ID — the bare domain a passkey is bound to. No scheme, no
   * port, no subdomain.
   *
   * Use the registrable domain rather than the host actually serving the app:
   * a credential registered against `opuspopuli.org` is usable from every
   * subdomain, whereas one bound to `app-us-ca.opuspopuli.org` is not — and
   * narrowing it later invalidates every passkey already registered.
   *
   * Undefined by default rather than falling back to `localhost` here.
   * `PasskeyService` owns that fallback, and it needs to distinguish "not
   * configured" from "configured as localhost" to decide whether to throw.
   */
  rpId: process.env.WEBAUTHN_RP_ID,

  /**
   * The full origin (scheme + host + port) the browser is on when registering
   * or asserting a credential. Must match exactly, including scheme.
   */
  origin: process.env.WEBAUTHN_ORIGIN,

  /** Human-readable name shown in the browser's passkey prompt. */
  rpName: process.env.WEBAUTHN_RP_NAME || 'Opus Populi',
}));

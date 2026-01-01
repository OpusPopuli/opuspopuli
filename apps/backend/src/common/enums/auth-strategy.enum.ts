/**
 * Authentication strategies supported by the platform
 */
export enum AuthStrategy {
  /** Traditional email/password authentication */
  PASSWORD = 'password',
  /** Passwordless magic link authentication */
  MAGIC_LINK = 'magic_link',
  /** WebAuthn/Passkey authentication */
  PASSKEY = 'passkey',
}

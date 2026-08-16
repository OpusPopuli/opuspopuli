import { registerAs } from '@nestjs/config';

/**
 * Authentication Rate Limiting Configuration
 *
 * Stricter rate limits for authentication endpoints to prevent:
 * - Brute force attacks on login
 * - Account enumeration via registration
 * - Email bombing via password reset
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/187
 */
export default registerAs('authThrottle', () => ({
  /**
   * Login rate limits
   * Prevents brute force attacks
   */
  login: {
    ttl: 60000, // 1 minute window
    limit: 5, // 5 attempts per minute
  },

  /**
   * Registration rate limits
   * Prevents account enumeration and spam registrations
   */
  register: {
    ttl: 60000, // 1 minute window
    limit: 3, // 3 attempts per minute
  },

  /**
   * Password reset rate limits
   * Prevents email bombing attacks
   */
  passwordReset: {
    ttl: 3600000, // 1 hour window
    limit: 3, // 3 attempts per hour
  },

  /**
   * Magic link rate limits
   * Prevents email bombing attacks
   */
  magicLink: {
    ttl: 60000, // 1 minute window
    limit: 3, // 3 attempts per minute
  },

  /**
   * Passkey authentication rate limits
   * Slightly more lenient since passkeys are more secure
   */
  passkey: {
    ttl: 60000, // 1 minute window
    limit: 10, // 10 attempts per minute
  },

  /**
   * Session refresh rate limits
   *
   * Deliberately the most lenient bucket here. Renewal is not an attack
   * surface the way login is — it requires a valid refresh token, and GoTrue
   * rejects a bad one regardless of how often it is presented. Meanwhile a
   * legitimate user with several tabs open can burst several renewals at once
   * when a token lapses. Throttling that too tightly would sign them out,
   * which is the failure this whole change exists to remove.
   */
  refresh: {
    ttl: 60000, // 1 minute window
    limit: 20, // 20 attempts per minute
  },

  /**
   * Account lockout configuration
   */
  lockout: {
    maxAttempts: 5, // Lock after 5 failed attempts
    lockoutDuration: 900000, // 15 minutes lockout
  },
}));

/**
 * Named throttle configurations for use with @Throttle decorator
 * These can be imported and used directly in resolvers
 */
export const AUTH_THROTTLE = {
  login: { name: 'auth-login', ttl: 60000, limit: 5 },
  register: { name: 'auth-register', ttl: 60000, limit: 3 },
  passwordReset: { name: 'auth-password-reset', ttl: 3600000, limit: 3 },
  magicLink: { name: 'auth-magic-link', ttl: 60000, limit: 3 },
  passkey: { name: 'auth-passkey', ttl: 60000, limit: 10 },
  refresh: { name: 'auth-refresh', ttl: 60000, limit: 20 },
  // Deliberately loose. Throttling sign-out protects nothing — the caller
  // already holds the session — and a rejected logout leaves the user
  // authenticated, which is the outcome this endpoint exists to prevent.
  logout: { name: 'auth-logout', ttl: 60000, limit: 30 },
} as const;

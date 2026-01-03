import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison utility to prevent timing attacks.
 *
 * Uses Node.js crypto.timingSafeEqual() which is designed to take
 * the same amount of time regardless of where strings differ.
 *
 * This should be used for ALL secret comparisons including:
 * - HMAC signatures
 * - CSRF tokens
 * - API keys
 * - Session tokens
 * - Any cryptographic or security-sensitive comparisons
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/195
 * @see https://codahale.com/a-lesson-in-timing-attacks/
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export function safeCompare(a: string, b: string): boolean {
  // Handle edge cases
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Convert strings to Buffers for comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // If lengths differ, we still need to do constant-time work
  // to prevent length-based timing attacks
  if (bufA.length !== bufB.length) {
    // Compare bufA with itself to ensure constant time
    // This prevents attackers from learning the correct length
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Constant-time check if a string is empty or undefined.
 * Used before safeCompare to avoid comparing empty strings.
 *
 * @param value - String to check
 * @returns true if string is non-empty, false otherwise
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const SENSITIVE_FIELDS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'secret',
  'apikey',
  'apisecret',
  'privatekey',
  'ssn',
  'socialsecuritynumber',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
]);

const PARTIAL_MASK_FIELDS = new Set(['email', 'phone', 'phonenumber']);

/**
 * PII patterns for detecting sensitive data in string values.
 * Used to redact PII that appears in log messages and error strings.
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
 */
export const PII_PATTERNS = {
  // Email: matches standard email format
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // Phone: matches various phone formats (US-centric with optional country code)
  phone: /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  // SSN: matches XXX-XX-XXXX format
  ssn: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
  // Credit Card: matches 13-19 digit card numbers with optional separators
  creditCard: /\b(?:\d{4}[-.\s]?){3,4}\d{1,4}\b/g,
  // IP Address: matches IPv4 format
  ipAddress: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
};

/**
 * Masks sensitive data in objects for audit logging.
 * Fully redacts sensitive fields (passwords, tokens, etc.)
 * Partially masks PII fields (email, phone)
 */
export function maskSensitiveData(
  data: unknown,
  depth = 0,
  maxDepth = 10,
): unknown {
  if (depth > maxDepth || data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveData(item, depth + 1, maxDepth));
  }

  if (typeof data === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.has(lowerKey)) {
        masked[key] = '[REDACTED]';
      } else if (
        PARTIAL_MASK_FIELDS.has(lowerKey) &&
        typeof value === 'string'
      ) {
        masked[key] = partialMask(value, lowerKey);
      } else {
        masked[key] = maskSensitiveData(value, depth + 1, maxDepth);
      }
    }
    return masked;
  }

  return data;
}

function partialMask(value: string, fieldType: string): string {
  if (fieldType === 'email') {
    const [local, domain] = value.split('@');
    if (local && domain) {
      const maskedLocal =
        local.length > 2
          ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
          : '*'.repeat(local.length);
      return `${maskedLocal}@${domain}`;
    }
  }
  if (fieldType === 'phone' || fieldType === 'phonenumber') {
    if (value.length > 4) {
      return '*'.repeat(value.length - 4) + value.slice(-4);
    }
  }
  return value.length > 4
    ? '*'.repeat(value.length - 4) + value.slice(-4)
    : '*'.repeat(value.length);
}

/**
 * Masks an email address for logging purposes.
 * Shows first and last character of local part + domain.
 * Example: john.doe@example.com -> j******e@example.com
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return '[REDACTED_EMAIL]';
  }
  const maskedLocal =
    local.length > 2
      ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
      : '*'.repeat(local.length);
  return `${maskedLocal}@${domain}`;
}

/**
 * Masks an IP address for logging purposes.
 * Shows only the first octet.
 * Example: 192.168.1.100 -> 192.x.x.x
 */
export function maskIpAddress(ip: string): string {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return '[REDACTED_IP]';
  }
  return `${parts[0]}.x.x.x`;
}

/**
 * Redacts PII patterns from a string value.
 * Used for sanitizing log messages that may contain embedded PII.
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
 */
export function redactPiiFromString(value: string): string {
  if (typeof value !== 'string') {
    return value;
  }

  let result = value;

  // Order matters: apply more specific patterns before general ones

  // Fully redact credit card numbers (before phone, as CC can look like phone)
  result = result.replaceAll(PII_PATTERNS.creditCard, '[REDACTED_CC]');

  // Fully redact SSN (before phone, as SSN can look like partial phone)
  result = result.replaceAll(PII_PATTERNS.ssn, '[REDACTED_SSN]');

  // Redact emails with partial masking (preserve domain for debugging)
  result = result.replaceAll(PII_PATTERNS.email, (match) => maskEmail(match));

  // Redact phone numbers (show last 4 digits)
  result = result.replaceAll(PII_PATTERNS.phone, (match) => {
    const digits = match.replaceAll(/\D/g, '');
    if (digits.length >= 4) {
      return `***-***-${digits.slice(-4)}`;
    }
    return '[REDACTED_PHONE]';
  });

  // Mask IP addresses (show first octet only)
  result = result.replaceAll(PII_PATTERNS.ipAddress, (match) =>
    maskIpAddress(match),
  );

  return result;
}

/**
 * Sanitizes any value for safe logging.
 * - Objects are processed with maskSensitiveData
 * - Strings are processed with redactPiiFromString
 * - Other types are passed through unchanged
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
 */
export function sanitizeForLogging(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactPiiFromString(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForLogging(item));
  }

  if (typeof data === 'object') {
    return maskSensitiveData(data);
  }

  return data;
}

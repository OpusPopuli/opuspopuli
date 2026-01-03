# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### Do NOT

- **Do NOT** create a public GitHub issue for security vulnerabilities
- **Do NOT** disclose the vulnerability publicly before it has been addressed

### How to Report

1. **Email**: Send details to **security@commonwealthlabs.io**
2. **Subject**: Use the format `[SECURITY] Brief description`
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

### What to Expect

| Timeline | Action |
|----------|--------|
| 48 hours | Initial acknowledgment of your report |
| 7 days | Preliminary assessment and severity rating |
| 30 days | Target for fix development (varies by severity) |
| 90 days | Maximum disclosure timeline (coordinated) |

### Severity Levels

- **Critical**: Immediate risk to user data or system integrity
- **High**: Significant security impact requiring prompt attention
- **Medium**: Moderate security impact with limited exposure
- **Low**: Minor security issues with minimal impact

## Security Practices

### Authentication

**Authentication Methods:**
- Passkeys (WebAuthn/FIDO2) as primary authentication
- Magic links for passwordless email authentication
- Password-based authentication (legacy fallback)

**Token Security:**
- JWT tokens stored in httpOnly cookies (not accessible to JavaScript)
- CSRF protection via stateless double-submit cookie pattern
- Automatic token refresh via secure refresh token cookies

**Architecture Security:**
- API Gateway validates browser requests via CSRF tokens
- Gateway signs requests to microservices using HMAC-SHA256
- Microservices only accept HMAC-signed requests from the gateway
- No secrets exposed in frontend code

See [Authentication Security Guide](docs/guides/auth-security.md) for detailed architecture.

### WebSocket Authentication

GraphQL subscriptions over WebSocket connections require JWT authentication to prevent unauthorized access to real-time data.

**How It Works:**

1. Client connects to WebSocket endpoint with JWT in connection params
2. Server validates JWT using Supabase Auth JWKS (same as HTTP requests)
3. Invalid tokens result in immediate connection rejection
4. Authenticated user is available in subscription context

**Frontend Connection:**

```typescript
import { createClient } from 'graphql-ws';

const wsClient = createClient({
  url: 'wss://api.example.com/api',
  connectionParams: {
    authorization: `Bearer ${accessToken}`,
  },
});
```

**Security Features:**

| Feature | Description |
|---------|-------------|
| JWT Validation | Same RS256 validation as HTTP requests |
| Token Refresh | Client must reconnect with new token when expired |
| Connection Rejection | Missing/invalid tokens rejected immediately |
| Audit Logging | All WebSocket auth attempts are logged |

**Configuration:**

WebSocket subscriptions are disabled by default. Enable via environment variable:

```bash
WEBSOCKET_ENABLED=true
WEBSOCKET_PATH=api
WEBSOCKET_KEEP_ALIVE=30000
```

See [websocket-auth.service.ts](apps/backend/src/common/auth/websocket-auth.service.ts) for implementation.

### Data Protection

- All data encrypted at rest (PostgreSQL, Supabase Storage)
- TLS/HTTPS for all data in transit
- Secrets managed via Supabase Vault
- No sensitive data in client-side storage

### Infrastructure

- Principle of least privilege for IAM roles
- Security groups with minimal port exposure
- Regular dependency updates via Dependabot
- Automated security scanning in CI/CD

### Security Headers

All services include comprehensive security headers via helmet middleware:

| Header | Protection |
|--------|------------|
| X-Frame-Options: DENY | Prevents clickjacking attacks |
| X-Content-Type-Options: nosniff | Prevents MIME type sniffing |
| Strict-Transport-Security | Forces HTTPS (1 year, includes subdomains) |
| X-DNS-Prefetch-Control: off | Prevents DNS prefetch privacy leaks |
| Referrer-Policy | Controls referrer information leakage |
| Cross-Origin-Opener-Policy | Isolates browsing context |
| Cross-Origin-Resource-Policy | Restricts cross-origin resource loading |

### Authentication Rate Limiting

All authentication endpoints have strict rate limits to prevent brute force and enumeration attacks:

| Endpoint | Limit | Window | Protection |
|----------|-------|--------|------------|
| Login | 5 requests | 1 minute | Brute force prevention |
| Registration | 3 requests | 1 minute | Account spam prevention |
| Password Reset | 3 requests | 1 hour | Email bombing prevention |
| Magic Link | 3 requests | 1 minute | Email bombing prevention |
| Passkey Auth | 10 requests | 1 minute | WebAuthn rate limiting |

**Account Lockout:**
- Accounts are locked after **5 failed login attempts**
- Lockout duration: **15 minutes**
- All lockout events are logged for security monitoring
- Lockout clears automatically on successful authentication

**Rate Limit Logging:**
All rate limit violations are logged with:
- Client IP address
- Operation attempted
- Limit exceeded details
- Timestamp

See [auth-throttle.config.ts](apps/backend/src/config/auth-throttle.config.ts) for configuration.

### Input Validation

All GraphQL inputs are validated using NestJS ValidationPipe with class-validator decorators:

**Global Validation Settings:**
- `whitelist: true` - Strips properties not defined in DTOs
- `forbidNonWhitelisted: true` - Rejects requests with unknown properties
- `transform: true` - Auto-transforms payloads to DTO instances

**Field Validation Rules:**

| Field Type | Validation | Max Length |
|------------|------------|------------|
| Email | Valid email format | 255 chars |
| Password | Uppercase, lowercase, digit, special char, min 8 chars | 128 chars |
| Username | Min 6 characters | 50 chars |
| Name fields | String type | 100 chars |
| Token/JWT | String type | 2048 chars |
| URL/redirectTo | Valid URL format | 2000 chars |

**Validation Protections:**
- Prevents buffer overflow attacks via max length limits
- Blocks injection attempts by sanitizing inputs
- Rejects malformed data before processing
- Provides clear error messages for invalid inputs

### CORS Configuration

Cross-Origin Resource Sharing (CORS) is configured to prevent unauthorized cross-origin requests:

**Production Mode:**
- Origins restricted to `ALLOWED_ORIGINS` environment variable
- Only whitelisted domains can make API requests
- Credentials (cookies) are included in cross-origin requests

**Development Mode:**
- All origins are allowed for easier local development
- Same security headers and method restrictions apply

**Configuration:**

| Setting | Value |
|---------|-------|
| Allowed Methods | GET, POST, OPTIONS |
| Allowed Headers | Content-Type, Authorization, X-Requested-With, X-CSRF-Token |
| Credentials | Enabled |
| Preflight Cache | 24 hours |

**Environment Variable:**
```bash
# Production example
ALLOWED_ORIGINS=https://app.qckstrt.com,https://admin.qckstrt.com
```

See [cors.config.ts](apps/backend/src/config/cors.config.ts) for configuration.

### Content Security Policy (CSP)

The frontend implements Content Security Policy headers to prevent XSS attacks by controlling which resources can be loaded:

**CSP Directives:**

| Directive | Policy | Purpose |
|-----------|--------|---------|
| default-src | 'self' | Only allow resources from same origin |
| script-src | 'self' 'unsafe-inline' | Allow scripts from same origin |
| style-src | 'self' 'unsafe-inline' fonts.googleapis.com | Allow styles and Google Fonts |
| font-src | 'self' fonts.gstatic.com data: | Allow fonts from Google and embedded |
| img-src | 'self' data: blob: https: | Allow images from HTTPS sources |
| connect-src | 'self' [API_ORIGIN] | Restrict API connections |
| frame-ancestors | 'none' | Prevent embedding (clickjacking) |
| base-uri | 'self' | Prevent base tag injection |
| form-action | 'self' | Restrict form submissions |
| object-src | 'none' | Block plugins (Flash, etc.) |

**Additional Headers:**

| Header | Value | Purpose |
|--------|-------|---------|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | DENY | Backup clickjacking protection |
| Referrer-Policy | strict-origin-when-cross-origin | Control referrer leakage |
| Permissions-Policy | camera=(), microphone=() | Restrict browser features |
| Strict-Transport-Security | max-age=31536000 (prod only) | Force HTTPS |

**CSP Violation Reporting:**

CSP violations can be reported to a dedicated endpoint for monitoring:

```bash
# Enable CSP reporting (optional)
CSP_REPORT_URI=https://app.qckstrt.com/api/csp-report
```

See [security-headers.config.mjs](apps/frontend/config/security-headers.config.mjs) for configuration.

### Error Handling & Information Disclosure Prevention

All error responses are sanitized to prevent information disclosure that could help attackers understand system internals.

**Error Sanitization:**

| Environment | Behavior |
|-------------|----------|
| Production | Generic error messages returned to clients |
| Development | Full error details for debugging |

**Sanitized Information:**
- Database schema details (table/column names)
- File system paths
- Stack traces
- Connection strings
- Internal IP addresses
- API keys or tokens in error messages

**Server-Side Logging:**
- Full error details are logged server-side for debugging
- Includes stack traces, query details, and context
- Available for investigation without exposing to clients

**User-Friendly Messages:**

| Error Type | Client Message |
|------------|----------------|
| 5xx errors | "An unexpected error occurred." |
| Unique violation | "This record already exists." |
| Foreign key error | "This operation references a record that does not exist." |
| Not null violation | "Required information is missing." |

See [error-sanitizer.ts](apps/backend/src/common/exceptions/error-sanitizer.ts) for configuration.

### Security Audit Logging

All security-relevant events are logged for monitoring, alerting, and forensic analysis. The audit log system provides comprehensive tracking of authentication and authorization events.

**Logged Security Events:**

| Category | Events Logged |
|----------|---------------|
| Authentication | Login success/failure, logout, account lockout/unlock |
| Password | Change, reset request, reset completion, failures |
| Registration | User registration, confirmation |
| Passkey (WebAuthn) | Registration, authentication, deletion |
| Magic Link | Send, verify, registration |
| Authorization | Access denied (guard rejections) |
| Permissions | Admin role granted/revoked |

**Audit Log Fields:**

| Field | Description |
|-------|-------------|
| requestId | Unique identifier for request tracing |
| userId | User ID (if authenticated) |
| userEmail | User email (if known) |
| action | Security event type (e.g., LOGIN, AUTHORIZATION_DENIED) |
| success | Whether the operation succeeded |
| resolverName | GraphQL resolver that was invoked |
| operationType | query, mutation, or subscription |
| ipAddress | Client IP address |
| userAgent | Client user agent |
| errorMessage | Error details (for failures) |
| timestamp | When the event occurred |

**PII Protection:**
- Sensitive fields (passwords, tokens) are masked in logs
- Email addresses are partially redacted in production
- Compliant with data protection requirements

**Batch Processing:**
- Non-critical events are batched for performance
- Critical security events (failures, denials) are logged synchronously
- Configurable batch size and flush intervals

**Log Retention:**
- Configurable retention period (default: 90 days)
- Automatic cleanup of old audit records
- Archived logs preserved for compliance requirements

See [audit-log.service.ts](apps/backend/src/common/services/audit-log.service.ts) for configuration.

### PII Redaction in Logs

All application logs are sanitized to prevent personally identifiable information (PII) from being exposed in log files.

**Automatic PII Redaction:**

| Data Type | Redaction Method | Example |
|-----------|------------------|---------|
| Email | Partial mask (first/last char + domain) | `j**n@example.com` |
| Phone | Show last 4 digits | `***-***-4567` |
| SSN | Full redaction | `[REDACTED_SSN]` |
| Credit Card | Full redaction | `[REDACTED_CC]` |
| IP Address | First octet only | `192.x.x.x` |
| Passwords | Full redaction | `[REDACTED]` |
| Tokens | Full redaction | `[REDACTED]` |

**SecureLogger Usage:**

Services handling sensitive data use `SecureLogger` instead of the standard NestJS Logger:

```typescript
import { SecureLogger } from 'src/common/services/secure-logger.service';

@Injectable()
export class MyService {
  private readonly logger = new SecureLogger(MyService.name);

  doSomething(email: string) {
    // Email will be automatically masked in logs
    this.logger.log(`Processing request for ${email}`);
    // Output: "Processing request for j**n@example.com"
  }
}
```

**Logging Guidelines:**

1. **Use SecureLogger** for any service that handles user data
2. **Never log raw passwords** - they should never appear in code that logs
3. **Avoid logging full objects** - use specific fields instead
4. **Log at appropriate levels** - use `warn` for security events, `error` for failures
5. **Include request IDs** - for tracing without exposing PII

See [pii-masker.ts](apps/backend/src/common/utils/pii-masker.ts) and [secure-logger.service.ts](apps/backend/src/common/services/secure-logger.service.ts) for implementation.

### Timing Attack Prevention

All security-sensitive string comparisons use constant-time comparison functions to prevent timing attacks.

**What are Timing Attacks?**

Timing attacks exploit the fact that naive string comparison (`===`) returns early when a mismatch is found. By measuring response times, attackers can:
- Guess valid HMAC signatures byte by byte
- Determine valid CSRF tokens
- Discover valid session tokens

**Protected Comparisons:**

| Location | Protected Value | Risk Level |
|----------|-----------------|------------|
| HMAC Middleware | HMAC signatures | Critical |
| CSRF Middleware | CSRF tokens | Medium |
| Passkey Service | Challenge verification | High (via @simplewebauthn) |

**Implementation:**

All secret comparisons use `crypto.timingSafeEqual()` via a utility wrapper:

```typescript
import { safeCompare } from 'src/common/utils/crypto.utils';

// Safe: Takes constant time regardless of where strings differ
if (safeCompare(providedToken, expectedToken)) {
  // Valid token
}

// Unsafe: Returns early on first mismatch (vulnerable)
// if (providedToken === expectedToken) { ... }
```

**Length Handling:**

When comparing strings of different lengths, the comparison still performs constant-time work to prevent length-based timing attacks.

See [crypto.utils.ts](apps/backend/src/common/utils/crypto.utils.ts) for implementation.

### Code Security

- Input validation on all user inputs via class-validator
- Parameterized queries (TypeORM)
- Strict CORS configuration for API endpoints
- Rate limiting on authentication endpoints
- Error sanitization prevents information disclosure
- Constant-time comparison for all cryptographic secrets

## Scope

This security policy applies to:

- The qckstrt core platform repository
- Official Commonwealth Labs deployments
- Infrastructure code in `/infra`

For region-specific forks, security policies may vary. Contact the fork maintainers directly.

## Recognition

We appreciate security researchers who help keep our community safe. With your permission, we will acknowledge your contribution in our security advisories.

## Contact

- **Security Issues**: security@commonwealthlabs.io
- **General Questions**: See [CONTRIBUTING.md](CONTRIBUTING.md)

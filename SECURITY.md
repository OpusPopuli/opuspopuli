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

### Code Security

- Input validation on all user inputs via class-validator
- Parameterized queries (TypeORM)
- CORS configuration for API endpoints
- Rate limiting on authentication endpoints

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

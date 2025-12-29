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

- Passkeys (WebAuthn/FIDO2) as primary authentication
- Magic links for passwordless email authentication
- JWT tokens with appropriate expiration
- Secure session management via Supabase Auth

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

### Code Security

- Input validation on all user inputs
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

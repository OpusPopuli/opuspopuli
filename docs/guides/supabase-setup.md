# Supabase Setup Guide

This guide explains how to set up Supabase services in Opus Populi.

## Overview

Supabase provides the core platform services for Opus Populi:

| Service | Provider | Description |
|---------|----------|-------------|
| Authentication | `SupabaseAuthProvider` | Supabase Auth (GoTrue) with Passkeys and Magic Links |
| Storage (dev) | `SupabaseStorageProvider` | Supabase Storage for local development |
| Storage (prod) | `R2StorageProvider` | Cloudflare R2 for production |
| Secrets | `EnvProvider` | Environment variable injection (default) |
| Database | PostgreSQL (via Supabase) | Relational + vector data via pgvector |

## Quick Start

### 1. Start the Supabase Stack

```bash
# Copy environment template
cp supabase/.env.example supabase/.env

# Edit the .env file with your secrets
nano supabase/.env

# Start all Supabase services
docker-compose -f docker-compose.supabase.yml up -d
```

### 2. Configure the Backend

Update your `apps/backend/.env`:

```bash
# Supabase Connection
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Provider Selection
AUTH_PROVIDER=supabase
STORAGE_PROVIDER=supabase
SECRETS_PROVIDER=supabase

# Database (connects to Supabase PostgreSQL)
RELATIONAL_DB_PROVIDER=postgres
RELATIONAL_DB_HOST=localhost
RELATIONAL_DB_PORT=5433
RELATIONAL_DB_DATABASE=postgres
RELATIONAL_DB_USERNAME=postgres
RELATIONAL_DB_PASSWORD=<your-postgres-password>
```

### 3. Set Up Vault Functions

The vault functions are automatically applied when the database starts. You can also apply them manually:

```bash
# Connect to Supabase PostgreSQL
psql -h localhost -p 5433 -U postgres -d postgres

# Run the migration
\i supabase/migrations/001_vault_functions.sql
```

## Services

### Supabase Auth (GoTrue)

**Port**: 9999 (internal), 8000/auth/* (via Kong)

**Features**:
- **Passkeys (WebAuthn/FIDO2)** - Primary passwordless authentication
- **Magic Links** - Email-based passwordless login
- Email/password authentication (legacy fallback)
- OAuth providers (Google, GitHub, etc.)
- JWT tokens
- User management
- Password recovery

**Environment Variables**:
```bash
# Auth Provider
AUTH_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=<your-key>

# WebAuthn/Passkey Configuration
WEBAUTHN_RP_NAME=Opus Populi
WEBAUTHN_RP_ID=localhost              # yourdomain.com in production
WEBAUTHN_ORIGIN=http://localhost:3000  # https://yourdomain.com in production

# Frontend URL for Magic Link redirects
FRONTEND_URL=http://localhost:3000
```

#### Passwordless Authentication

Opus Populi supports three authentication methods, with passwordless options as the primary approach:

1. **Passkeys (WebAuthn/FIDO2)** - Biometric/PIN authentication using platform authenticators
2. **Magic Links** - Email-based passwordless login (like Medium)
3. **Password** - Traditional password-based authentication (legacy fallback)

**Magic Link Usage**:
```typescript
@Inject('AUTH_PROVIDER')
private authProvider: IAuthProvider;

// Send magic link email
await this.authProvider.sendMagicLink(
  'user@example.com',
  'http://localhost:3000/auth/callback'
);

// Verify magic link token (handled in callback)
const tokens = await this.authProvider.verifyMagicLink(
  'user@example.com',
  tokenFromUrl
);

// Register with magic link (email-first flow)
await this.authProvider.registerWithMagicLink(
  'newuser@example.com',
  'http://localhost:3000/auth/callback?type=register'
);
```

**Passkey Usage** (via PasskeyService):
```typescript
@Inject(PasskeyService)
private passkeyService: PasskeyService;

// Generate registration options
const options = await this.passkeyService.generateRegistrationOptions(
  userId,
  'user@example.com',
  'John Doe'
);

// Verify registration response from browser
const verification = await this.passkeyService.verifyRegistration(
  'user@example.com',
  browserResponse
);

// Save credential
await this.passkeyService.saveCredential(userId, verification, 'MacBook Pro');

// Generate authentication options
const { options, identifier } = await this.passkeyService.generateAuthenticationOptions(
  'user@example.com'
);

// Verify authentication response
const { verification, user } = await this.passkeyService.verifyAuthentication(
  identifier,
  browserResponse
);
```

**Password Authentication** (Legacy):
```typescript
@Inject('AUTH_PROVIDER')
private authProvider: IAuthProvider;

// Register a user with password
const userId = await this.authProvider.registerUser({
  email: 'user@example.com',
  username: 'testuser',
  password: 'SecurePassword123!',
});

// Authenticate with password
const tokens = await this.authProvider.authenticateUser(
  'user@example.com',
  'SecurePassword123!'
);
```

#### Passkey Database Schema

Passkeys require two database tables (auto-created via Prisma migrations):

**passkey_credentials**:
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| userId | UUID | Foreign key to users |
| credentialId | TEXT | WebAuthn credential ID (unique) |
| publicKey | TEXT | COSE public key |
| counter | BIGINT | Replay attack prevention |
| aaguid | VARCHAR | Authenticator AAGUID |
| deviceType | VARCHAR | 'singleDevice' or 'multiDevice' |
| backedUp | BOOLEAN | Whether credential is backed up |
| friendlyName | VARCHAR | User-provided name (e.g., "MacBook Pro") |
| transports | JSON | Supported transports array |
| createdAt | TIMESTAMP | Creation time |
| lastUsedAt | TIMESTAMP | Last authentication time |

**webauthn_challenges**:
| Column | Type | Description |
|--------|------|-------------|
| identifier | VARCHAR | Email or session ID (PK) |
| challenge | TEXT | Base64-encoded challenge |
| type | VARCHAR | 'registration' or 'authentication' |
| createdAt | TIMESTAMP | Creation time |
| expiresAt | TIMESTAMP | Expiration (5 minutes) |

### Supabase Storage

**Port**: 5000 (internal), 8000/storage/* (via Kong)

**Features**:
- File uploads/downloads
- Signed URLs
- Bucket management
- Image transformations

**Environment Variables**:
```bash
STORAGE_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

**Usage in Code**:
```typescript
@Inject('STORAGE_PROVIDER')
private storageProvider: IStorageProvider;

// Get signed URL for download
const url = await this.storageProvider.getSignedUrl(
  'my-bucket',
  'path/to/file.pdf',
  false, // false = download
);

// Get signed URL for upload
const uploadUrl = await this.storageProvider.getSignedUrl(
  'my-bucket',
  'uploads/new-file.pdf',
  true, // true = upload
);
```

### Supabase Vault

**Backend**: PostgreSQL pgsodium extension

**Features**:
- Encrypted secret storage
- Row-level security
- SQL-based access

**Environment Variables**:
```bash
SECRETS_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

**Creating Secrets**:

1. **Via Supabase Studio** (http://localhost:3100):
   - Navigate to Database > Vault
   - Click "Add new secret"
   - Enter name and value

2. **Via SQL**:
   ```sql
   SELECT vault.create_secret('my-secret-value', 'my-secret-name');
   ```

**Usage in Code**:
```typescript
@Inject('SECRETS_PROVIDER')
private secretsProvider: ISecretsProvider;

// Get a secret
const apiKey = await this.secretsProvider.getSecret('api-key');

// Get JSON secret
const dbCredentials = await this.secretsProvider.getSecretJson<{
  username: string;
  password: string;
}>('db-credentials');
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                         │
└─────────────────────────────────────────────────────────────┘
                            │
                    Provider Selection
                    (via ConfigService)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ AuthProvider │   │StorageProvider│   │SecretsProvider│
│  - Supabase ◄│   │  - Supabase ◄│   │    - Env   ◄ │
│              │   │  - R2        │   │  - Supabase  │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────────────┐
                    │   Supabase    │
                    │   Stack       │
                    │ ┌───────────┐ │
                    │ │   Kong    │ │ ◄─── :8000
                    │ └───────────┘ │
                    │       │       │
                    │ ┌─────┼─────┐ │
                    │ ▼     ▼     ▼ │
                    │Auth  REST  Stor│
                    │       │       │
                    │ ┌───────────┐ │
                    │ │ PostgreSQL│ │ ◄─── :5433
                    │ └───────────┘ │
                    └───────────────┘
```

## Access Points

| Service | URL | Description |
|---------|-----|-------------|
| API Gateway | http://localhost:8000 | Kong routes to all services |
| Studio UI | http://localhost:3100 | Admin dashboard |
| PostgreSQL | localhost:5433 | Direct database access |
| Auth API | http://localhost:8000/auth/v1 | Authentication endpoints |
| REST API | http://localhost:8000/rest/v1 | PostgREST endpoints |
| Storage API | http://localhost:8000/storage/v1 | File storage endpoints |

## Security Considerations

### Production Checklist

1. **Change Default Secrets**:
   ```bash
   # Generate secure JWT secret
   openssl rand -base64 32

   # Generate secure database password
   openssl rand -base64 24
   ```

2. **Generate New API Keys**:
   - Use the [Supabase key generator](https://supabase.com/docs/guides/self-hosting#generate-api-keys)
   - Never use demo keys in production

3. **Configure HTTPS**:
   - Put Kong behind a reverse proxy (nginx/traefik)
   - Enable TLS certificates

4. **Restrict Network Access**:
   - Don't expose PostgreSQL port (5433) publicly
   - Use firewall rules to restrict access

5. **Enable Email Verification**:
   ```bash
   ENABLE_EMAIL_AUTOCONFIRM=false
   ```

6. **Configure SMTP** (Required for Magic Links):
   ```bash
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-user
   SMTP_PASS=your-password
   SMTP_SENDER_NAME=Opus Populi
   ```

7. **Configure WebAuthn for Production**:
   ```bash
   # Must match your production domain
   WEBAUTHN_RP_NAME=Your App Name
   WEBAUTHN_RP_ID=yourdomain.com
   WEBAUTHN_ORIGIN=https://yourdomain.com

   # HTTPS is required for WebAuthn (except localhost)
   ```

8. **Magic Link Security**:
   - Magic links expire after 2 hours (Supabase default)
   - Links are single-use and invalidated after verification
   - Always use HTTPS for redirect URLs in production

## Switching Storage Providers

To switch between storage providers, change the environment variable:

```bash
# Use Supabase Storage (default, for local dev)
STORAGE_PROVIDER=supabase

# Use Cloudflare R2 (for production)
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<your-account-id>
R2_ACCESS_KEY_ID=<your-access-key>
R2_SECRET_ACCESS_KEY=<your-secret-key>
```

No code changes required - the provider pattern handles the abstraction.

## Troubleshooting

### Common Issues

**1. Connection refused to Supabase**
```bash
# Check if services are running
docker-compose -f docker-compose.supabase.yml ps

# Check logs
docker-compose -f docker-compose.supabase.yml logs supabase-kong
```

**2. Authentication errors**
```bash
# Verify API keys in Studio
# Navigate to Settings > API

# Check JWT secret matches between services
docker-compose -f docker-compose.supabase.yml logs supabase-auth
```

**3. Vault functions not found**
```sql
-- Connect to PostgreSQL and verify
SELECT * FROM information_schema.routines
WHERE routine_name = 'vault_read_secret';

-- Re-run migration if needed
\i supabase/migrations/001_vault_functions.sql
```

**4. Storage bucket doesn't exist**
```bash
# Create bucket via Studio or API
curl -X POST 'http://localhost:8000/storage/v1/bucket' \
  -H 'Authorization: Bearer <service-role-key>' \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-bucket", "public": false}'
```

## Related Documentation

- [Provider Pattern Architecture](../architecture/provider-pattern.md)
- [Getting Started Guide](getting-started.md)
- [Supabase Documentation](https://supabase.com/docs)

# Secrets Management

This guide covers how to configure and use secrets management in Opus Populi.

## Overview

Opus Populi provides a pluggable secrets management system with multiple provider backends:

| Provider | `SECRETS_PROVIDER=` | Use Case |
|----------|---------------------|----------|
| EnvProvider | `env` (default) | Local dev, Docker, K8s, GCP, Azure |
| SupabaseVaultProvider | `supabase` | Supabase Cloud users |

**Key Insight**: The `EnvProvider` is the universal adapter. Most cloud platforms (GCP Cloud Run, Azure App Service, Kubernetes, etc.) inject secrets as environment variables, so `SECRETS_PROVIDER=env` works everywhere.

## Architecture

```
Operators choose their infrastructure:

  Kubernetes:    K8s secrets → SECRETS_PROVIDER=env
  GCP user:      GCP injects env → SECRETS_PROVIDER=env
  Azure user:    Azure injects env → SECRETS_PROVIDER=env
  Supabase:      SECRETS_PROVIDER=supabase
  Simple/Local:  SECRETS_PROVIDER=env (default)
```

## Configuration

### Environment Variables

```bash
# Select your provider (default: env)
SECRETS_PROVIDER=env
```

### Provider Details

#### EnvProvider (Default)

The simplest and most universal provider. Reads secrets directly from `process.env`.

**Configuration:**
```bash
SECRETS_PROVIDER=env  # or omit (this is the default)

# Your secrets as environment variables
DB_PASSWORD=your-password
JWT_SECRET=your-secret
API_KEYS={"client1":"key1","client2":"key2"}
```

**Use Cases:**
- Local development
- Docker Compose
- Kubernetes (secrets mounted as env vars)
- GCP Cloud Run (secrets injected as env vars)
- Azure App Service (configuration as env vars)
- Any platform that supports environment variable injection

#### SupabaseVaultProvider

Reads secrets from Supabase Vault for Supabase Cloud deployments.

**Configuration:**
```bash
SECRETS_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Bootstrap-Time Vault Hydration

When `SECRETS_PROVIDER=supabase`, a bootstrap step in the shared backend startup (`apps/backend/src/common/bootstrap.ts`) reads a fixed list of named secrets from Vault and writes them into `process.env` **before** NestJS is constructed. `@nestjs/config`'s `registerAs` factories read `process.env` at module-init time, so the hydration must run earlier — once it does, every existing `process.env.X` read in `config-provider` resolves to the Vault-backed value with zero per-module changes.

### Policy when `SECRETS_PROVIDER=supabase`

- **Vault is authoritative.** When a secret is present in Vault, its value overwrites any existing env value, and the overwrite is logged as a WARN (so operator mistakes are loud, not silent).
- **Missing secrets are tolerated.** When a secret is not present in Vault, the existing env value (which may be empty) is left in place, and a WARN logs the gap. Service startup is not blocked — a partially-populated Vault during incremental migration won't crash the app.
- **Per-secret timeout.** Each Vault lookup has a 10s deadline (`Promise.race`). A network partition cannot hang service startup indefinitely.
- **Parallel reads.** The full secret list is hydrated concurrently with `Promise.all`.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required to reach Vault and therefore stay as env vars by necessity (chicken-and-egg).

### Vault-Managed Secrets

The current list lives in `apps/backend/src/common/bootstrap.ts` as `VAULT_BACKED_SECRETS`:

| Secret | Auto-seeded by `db-migrate.sh`? | Notes |
|---|---|---|
| `RESEND_API_KEY` | ❌ operator | Resend HTTP API key for app emails |
| `SMTP_USER` | ❌ operator | Resend SMTP relay username (literal `"resend"`) — only needed when `SMTP_HOST=smtp.resend.com` |
| `SMTP_PASS` | ❌ operator | Resend API key for SMTP relay — only needed when flipping to Resend SMTP |
| `R2_ACCOUNT_ID` | ❌ operator | Cloudflare R2 storage — only needed when `STORAGE_PROVIDER=cloudflare` |
| `R2_ACCESS_KEY_ID` | ❌ operator | Same |
| `R2_SECRET_ACCESS_KEY` | ❌ operator | Same |
| `REDIS_URL` | ✅ defaults to `redis://redis:6379` | Override via `SEED_REDIS_URL` env at deploy time for managed Redis with auth |
| `SUPABASE_ANON_KEY` | ✅ defaults to well-known self-hosted dev JWT | Override via `SEED_SUPABASE_ANON_KEY` for hosted Supabase projects |
| `FEC_API_KEY` | ❌ operator | data.gov API key for federal campaign-finance data |
| `SENSITIVE_PROFILE_ENCRYPTION_KEY` | ✅ defaults to deterministic dev key | Consumed by `EncryptionService` via per-consumer DI; override via `SEED_SENSITIVE_PROFILE_ENCRYPTION_KEY` |

**`JWT_SECRET`, `AUTH_JWT_SECRET`, `GATEWAY_HMAC_SECRET`, and `API_KEYS` are intentionally NOT in this list.** They need fail-fast semantics on missing-secret rather than the current tolerant warn-and-continue. Migrating them requires extending the hydration mechanism with a strict mode — tracked as a future enhancement.

### Seeding Operator-Required Secrets

Use the idempotent `vault_create_secret` RPC (installed by `db-migrate`):

```sql
-- From Supabase Studio's SQL Editor, or psql against the project database
SELECT public.vault_create_secret(
  'RESEND_API_KEY',
  're_your_real_key_here',
  'Resend HTTP API key (sending-access scope)'
);

SELECT public.vault_create_secret(
  'FEC_API_KEY',
  'your_data_gov_api_key',
  'data.gov / FEC API key for federal campaign-finance ingestion'
);
```

For prod deploys, prefer setting `SEED_*` env vars on the `db-migrate` job so the seed values come from your deployment secrets and not from a manual SQL session.

### Switching Magic-Link Delivery (Inbucket ↔ Resend)

By default the local UAT stack routes magic links through Inbucket (the in-cluster email catcher). `docker-compose.yml` sets `GOTRUE_SMTP_HOST: ${SMTP_HOST:-inbucket}`, so without any override magic links land at http://localhost:9000 (Inbucket UI).

To switch GoTrue to send real magic links via Resend SMTP:

1. Seed `SMTP_USER` (literal `resend`) and `SMTP_PASS` (your Resend API key) in Vault — see the SQL example above.
2. Restart the UAT stack with `SMTP_HOST` and `SMTP_PORT` overridden at shell time:

```bash
SMTP_HOST=smtp.resend.com SMTP_PORT=465 \
  docker compose -f docker-compose-uat.yml up -d --force-recreate
```

3. Drop the override to switch back to Inbucket — no code change, no compose change.

This keeps Inbucket as the friction-free default for local dev while making real Resend delivery a one-command toggle for end-to-end testing.

## Usage

### Dependency Injection (Recommended)

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { SECRETS_PROVIDER, ISecretsProvider } from '@opuspopuli/secrets-provider';

@Injectable()
export class MyService {
  constructor(
    @Inject(SECRETS_PROVIDER) private secrets: ISecretsProvider,
  ) {}

  async doSomething() {
    // Get a single secret
    const apiKey = await this.secrets.getSecret('API_KEY');

    // Get multiple secrets at once
    const secrets = await this.secrets.getSecrets(['DB_PASSWORD', 'JWT_SECRET']);

    // Get a JSON secret with type safety
    const config = await this.secrets.getSecretJson<{ host: string; port: number }>('DB_CONFIG');
  }
}
```

### Bootstrap Helpers (Before DI Available)

For scenarios where you need secrets before the NestJS DI container is ready:

```typescript
// EnvProvider helper
import { getEnvSecret, getEnvSecretOrThrow } from '@opuspopuli/secrets-provider';

const optionalValue = getEnvSecret('OPTIONAL_SECRET');
const requiredValue = getEnvSecretOrThrow('REQUIRED_SECRET'); // Throws if missing
```

## Adding a New Provider

To add support for a new secrets backend:

1. Create a new provider class implementing `ISecretsProvider`:

```typescript
// packages/secrets-provider/src/providers/my-provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISecretsProvider, SecretsError } from '@opuspopuli/common';

@Injectable()
export class MySecretsProvider implements ISecretsProvider {
  private readonly logger = new Logger(MySecretsProvider.name);

  constructor(private configService: ConfigService) {
    // Initialize your provider
  }

  getName(): string {
    return 'MySecretsProvider';
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    // Implement secret retrieval
  }

  async getSecrets(secretIds: string[]): Promise<Record<string, string | undefined>> {
    // Implement batch retrieval
  }

  async getSecretJson<T>(secretId: string): Promise<T | undefined> {
    // Implement JSON parsing
  }
}
```

2. Register in the module factory (`secrets.module.ts`):

```typescript
case 'myprovider':
  return new MySecretsProvider(configService);
```

3. Export from `index.ts`:

```typescript
export { MySecretsProvider } from './providers/my-provider.js';
```

## Best Practices

### Development

- Use `SECRETS_PROVIDER=env` with secrets in `.env` (gitignored)
- Never commit real secrets to version control

### Production

- **Kubernetes**: Mount secrets as environment variables, use `SECRETS_PROVIDER=env`
- **GCP/Azure**: Use platform secret injection, use `SECRETS_PROVIDER=env`
- **Supabase**: Use `SECRETS_PROVIDER=supabase` with Supabase Vault

### General

- Use `getSecretJson` for structured configuration
- Validate required secrets at startup, not at runtime

## Troubleshooting

### "Secret not found"

- **EnvProvider**: Check that the environment variable is set
- **SupabaseVaultProvider**: Check the secret exists in Supabase Vault

### "N secret(s) requested but not found in Vault" at service startup

This is the bootstrap-hydration helper noting that one or more entries in `VAULT_BACKED_SECRETS` aren't seeded yet. Service startup is **not** blocked — the existing env value (which may be empty) is left in place. Resolve by either:
- Seeding the missing secret via `vault_create_secret` RPC (see "Seeding Operator-Required Secrets").
- Removing the secret from `VAULT_BACKED_SECRETS` if it's no longer needed.

### "Vault values overwrote existing env vars" at service startup

The hydration policy when `SECRETS_PROVIDER=supabase` is that Vault is authoritative — when a Vault value differs from the existing env value, the env value is overwritten and the difference is logged loudly. This is intentional: env values for vault-managed secrets are a policy violation per CLAUDE.md and shouldn't be silently honored. To resolve, either remove the conflicting env var from compose, or update Vault to match.

### `pgsodium_crypto_aead_det_decrypt_by_id: invalid ciphertext`

The pgsodium master key has changed since the secret was encrypted — see issue [#791](https://github.com/OpusPopuli/opuspopuli/issues/791) for the durability investigation. Workaround for local dev:
```sql
DELETE FROM vault.secrets WHERE name = 'SECRET_NAME';
SELECT vault.create_secret('value', 'SECRET_NAME', 'description');
```
The idempotent `vault_create_secret` RPC cannot recover from this state — tracked as [#789](https://github.com/OpusPopuli/opuspopuli/issues/789).

## API Reference

### ISecretsProvider Interface

```typescript
interface ISecretsProvider {
  /** Get provider name for logging */
  getName(): string;

  /** Retrieve a single secret by ID */
  getSecret(secretId: string): Promise<string | undefined>;

  /** Retrieve multiple secrets at once */
  getSecrets(secretIds: string[]): Promise<Record<string, string | undefined>>;

  /** Retrieve and parse a JSON secret */
  getSecretJson<T>(secretId: string): Promise<T | undefined>;
}
```

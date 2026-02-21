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

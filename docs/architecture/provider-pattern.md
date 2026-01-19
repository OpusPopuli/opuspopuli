# Provider Pattern Architecture

## Overview

QCKSTRT uses the **Strategy Pattern + Dependency Injection** to create a pluggable provider architecture. This allows swapping implementations via configuration without code changes.

## Design Pattern

### Strategy Pattern
Each provider layer defines an interface that implementations can satisfy:

```typescript
// Interface defines the contract
interface IRelationalDBProvider {
  getName(): string;
  getConnectionOptions(entities): DataSourceOptions;
  isAvailable(): Promise<boolean>;
}

// Implementation
class PostgresProvider implements IRelationalDBProvider { ... }
```

### Dependency Injection
NestJS modules provide the correct implementation at runtime:

```typescript
@Module({
  providers: [
    {
      provide: 'RELATIONAL_DB_PROVIDER',
      useFactory: (config: ConfigService): IRelationalDBProvider => {
        const provider = config.get('relationaldb.provider') || 'postgres';

        switch (provider) {
          case 'postgres':
          default: return new PostgresProvider(...);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['RELATIONAL_DB_PROVIDER'],
})
export class RelationalDBModule {}
```

### Service Consumption
Services receive the provider via constructor injection:

```typescript
@Injectable()
export class MyService {
  constructor(
    @Inject('RELATIONAL_DB_PROVIDER')
    private db: IRelationalDBProvider
  ) {
    this.logger.log(`Using ${this.db.getName()}`);
  }
}
```

## Provider Layers

### 1. Relational Database Provider

**Package**: `@qckstrt/relationaldb-provider`

**Purpose**: Abstract relational database connections (PostgreSQL via Supabase)

**Interface**:
```typescript
export interface IRelationalDBProvider {
  getName(): string;
  getType(): RelationalDBType;
  getConnectionOptions(entities: DataSourceOptions['entities']): DataSourceOptions;
  isAvailable(): Promise<boolean>;
}
```

**Implementation**:

| Provider | File | Use Case | Setup Time |
|----------|------|----------|------------|
| PostgreSQL | `packages/relationaldb-provider/src/providers/postgres.provider.ts` | Default (via Supabase) | 1 minute (docker-compose up) |

**Configuration**:
```bash
# PostgreSQL via Supabase
RELATIONAL_DB_PROVIDER=postgres
RELATIONAL_DB_HOST=localhost
RELATIONAL_DB_PORT=5432
RELATIONAL_DB_DATABASE=postgres
RELATIONAL_DB_USERNAME=postgres
RELATIONAL_DB_PASSWORD=your-super-secret-password
```

**Module**: `RelationalDBModule`

**Consumed By**: `DbModule` (TypeORM integration)

---

### 2. Vector Database Provider

**Package**: `@qckstrt/vectordb-provider`

**Purpose**: Abstract vector storage and similarity search (pgvector on PostgreSQL)

**Interface**:
```typescript
export interface IVectorDBProvider {
  initialize(): Promise<void>;

  createEmbeddings(
    userId: string,
    documentId: string,
    embeddings: number[][],
    content: string[]
  ): Promise<boolean>;

  queryEmbeddings(
    queryEmbedding: number[],
    userId: string,
    nResults?: number
  ): Promise<IVectorDocument[]>;

  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>;
  deleteEmbeddingById(id: string): Promise<void>;

  getName(): string;
  getDimensions(): number;
}
```

**Implementation**:

| Provider | File | Use Case | Performance |
|----------|------|----------|-------------|
| pgvector | `packages/vectordb-provider/src/providers/pgvector.provider.ts` | Default | Fast (consolidated with PostgreSQL) |

**Configuration**:
```bash
# pgvector (uses same PostgreSQL instance)
# Falls back to RELATIONAL_DB_* config if not specified
VECTOR_DB_HOST=localhost
VECTOR_DB_PORT=5432
VECTOR_DB_DIMENSIONS=384
```

**Module**: `VectorDBModule`

**Consumed By**: `KnowledgeService`

---

### 3. Embeddings Provider

**Package**: `@qckstrt/embeddings-provider`

**Purpose**: Generate vector embeddings from text (Xenova, Ollama)

**Interface**:
```typescript
export interface IEmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  getDimensions(): number;
  getName(): string;
}
```

**Implementations**:

| Provider | File | Use Case | Dimensions | Setup |
|----------|------|----------|------------|-------|
| Xenova | `packages/embeddings-provider/src/providers/xenova.provider.ts` | Development (default) | 384 | None (auto-downloads) |
| Ollama | `packages/embeddings-provider/src/providers/ollama.provider.ts` | GPU acceleration | 768 | Requires Ollama server |

**Configuration**:
```bash
# Xenova (default - in-process)
EMBEDDINGS_PROVIDER=xenova
EMBEDDINGS_XENOVA_MODEL=Xenova/all-MiniLM-L6-v2

# Ollama (GPU-accelerated)
EMBEDDINGS_PROVIDER=ollama
EMBEDDINGS_OLLAMA_URL=http://localhost:11434
EMBEDDINGS_OLLAMA_MODEL=nomic-embed-text
```

**Module**: `EmbeddingsModule`

**Consumed By**: `EmbeddingsService` → `KnowledgeService`

**Text Processing**:
```typescript
// EmbeddingsService handles chunking
export class EmbeddingsService {
  async getEmbeddingsForText(text: string): Promise<{
    embeddings: number[][];
    texts: string[];
  }> {
    // 1. Split text into chunks
    const chunks = this.chunkText(text);

    // 2. Generate embeddings via provider
    const embeddings = await this.provider.embedDocuments(chunks);

    return { embeddings, texts: chunks };
  }
}
```

---

### 4. LLM Provider

**Package**: `@qckstrt/llm-provider`

**Purpose**: Generate text using language models (Ollama with Falcon/Llama/Mistral)

**Interface**:
```typescript
export interface ILLMProvider {
  getName(): string;
  getModelName(): string;

  generate(
    prompt: string,
    options?: GenerateOptions
  ): Promise<GenerateResult>;

  generateStream(
    prompt: string,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown>;

  chat(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): Promise<GenerateResult>;

  isAvailable(): Promise<boolean>;
}
```

**Implementation**:

| Provider | File | Models | Use Case |
|----------|------|--------|----------|
| Ollama | `packages/llm-provider/src/providers/ollama.provider.ts` | Falcon 7B (default), Llama 3.2, Mistral, etc. | Self-hosted LLM |

**Configuration**:
```bash
# Ollama (self-hosted)
LLM_URL=http://localhost:11434
LLM_MODEL=falcon  # or llama3.2, mistral, etc.
```

**Module**: `LLMModule`

**Consumed By**: `KnowledgeService`

**Generation Options**:
```typescript
interface GenerateOptions {
  maxTokens?: number;      // Max tokens to generate (default: 512)
  temperature?: number;    // Randomness 0.0-1.0 (default: 0.7)
  topP?: number;          // Nucleus sampling (default: 0.95)
  topK?: number;          // Top-K sampling (default: 40)
  stopSequences?: string[]; // Stop generation at these strings
  stream?: boolean;        // Stream response token-by-token
}
```

---

### 5. Authentication Provider

**Package**: `@qckstrt/auth-provider`

**Purpose**: Abstract user authentication and management with support for passwordless authentication

**Interface**:
```typescript
export interface IAuthProvider {
  getName(): string;

  // Password-based authentication
  registerUser(params: IRegisterUserParams): Promise<string>;
  authenticateUser(email: string, password: string): Promise<IAuthTokens>;
  confirmUser(username: string): Promise<void>;
  deleteUser(username: string): Promise<boolean>;
  addToGroup(username: string, groupName: string): Promise<void>;
  removeFromGroup(username: string, groupName: string): Promise<void>;
  changePassword(accessToken: string, oldPassword: string, newPassword: string): Promise<boolean>;
  forgotPassword(usernameOrEmail: string): Promise<boolean>;
  confirmForgotPassword(usernameOrEmail: string, newPassword: string, confirmationCode: string): Promise<boolean>;

  // Passwordless authentication (optional)
  sendMagicLink?(email: string, redirectTo?: string): Promise<boolean>;
  verifyMagicLink?(email: string, token: string): Promise<IAuthResult>;
  registerWithMagicLink?(email: string, redirectTo?: string): Promise<boolean>;
}
```

**Implementation**:

| Provider | File | Use Case | Features |
|----------|------|----------|----------|
| Supabase | `packages/auth-provider/src/providers/supabase.provider.ts` | Default | JWT, OAuth, Magic Links, Passwordless |

**Configuration**:
```bash
# Supabase Auth
AUTH_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=your-key
```

**Module**: `AuthModule`

#### Passwordless Authentication

The authentication system supports three authentication methods:

1. **Passkeys (WebAuthn/FIDO2)** - Primary method using biometric/PIN authentication
2. **Magic Links** - Email-based passwordless login (like Medium)
3. **Password** - Traditional password-based authentication (legacy fallback)

**Passkey Service** (`apps/backend/src/apps/users/src/domains/auth/services/passkey.service.ts`):
```typescript
// Passkey registration and authentication using @simplewebauthn/server
export class PasskeyService {
  generateRegistrationOptions(userId, email, displayName): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(email, response): Promise<VerifiedRegistrationResponse>;
  saveCredential(userId, verification, friendlyName?): Promise<PasskeyCredentialEntity>;
  generateAuthenticationOptions(email?): Promise<{ options, identifier }>;
  verifyAuthentication(identifier, response): Promise<{ verification, user }>;
  getUserCredentials(userId): Promise<PasskeyCredentialEntity[]>;
  deleteCredential(credentialId, userId): Promise<boolean>;
}
```

**Database Entities**:
- `PasskeyCredentialEntity` - Stores WebAuthn credentials (credentialId, publicKey, counter, etc.)
- `WebAuthnChallengeEntity` - Temporary challenge storage with 5-minute TTL

**Frontend Integration**:
```typescript
// Auth context provides passwordless methods
const {
  supportsPasskeys,
  loginWithPasskey,
  registerPasskey,
  sendMagicLink,
  verifyMagicLink,
  registerWithMagicLink,
} = useAuth();
```

---

### 6. Storage Provider

**Package**: `@qckstrt/storage-provider`

**Purpose**: Abstract file storage operations (Supabase Storage)

**Interface**:
```typescript
export interface IStorageProvider {
  getName(): string;
  listFiles(bucket: string, prefix: string): Promise<IListFilesResult>;
  getSignedUrl(bucket: string, key: string, upload: boolean, options?: ISignedUrlOptions): Promise<string>;
  deleteFile(bucket: string, key: string): Promise<boolean>;
  exists(bucket: string, key: string): Promise<boolean>;
  getMetadata(bucket: string, key: string): Promise<IStorageFile | null>;
}
```

**Implementation**:

| Provider | File | Use Case | Features |
|----------|------|----------|----------|
| Supabase | `packages/storage-provider/src/providers/supabase.provider.ts` | Default | RLS, Transformations |

**Configuration**:
```bash
# Supabase Storage
STORAGE_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=your-key
```

**Module**: `StorageModule`

---

### 7. Email Provider

**Package**: `@qckstrt/email-provider`

**Purpose**: Abstract email sending via transactional email services (Resend)

**Interface**:
```typescript
export interface IEmailProvider {
  getName(): string;
  send(options: ISendEmailOptions): Promise<IEmailResult>;
  sendBatch(emails: ISendEmailOptions[]): Promise<IEmailResult[]>;
}

export interface ISendEmailOptions {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface IEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}
```

**Implementation**:

| Provider | File | Use Case | Features |
|----------|------|----------|----------|
| Resend | `packages/email-provider/src/providers/resend.provider.ts` | Default | Transactional email, webhooks, analytics |

**Configuration**:
```bash
# Resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM_ADDRESS=noreply@commonwealthlabs.io
EMAIL_FROM_NAME=Commonwealth Labs
EMAIL_REPLY_TO=support@commonwealthlabs.io
```

**Module**: `EmailProviderModule`

**Consumed By**: `EmailDomainService` (welcome emails, representative contact)

**Email Templates**:
- Welcome email (after registration)
- Representative contact (user-to-representative correspondence)

**Email History**: All sent emails are tracked in `EmailCorrespondenceEntity` for user reference.

---

### 8. Extraction Provider

**Package**: `@qckstrt/extraction-provider`

**Purpose**: Extract text from URLs and PDFs with caching, rate limiting, and retry logic

**Interface**:
```typescript
export interface ExtractionProvider {
  // Fetch URL with rate limiting and caching
  fetchUrl(url: string, options?: FetchOptions): Promise<CachedFetchResult>;

  // Extract text from PDF buffer
  extractPdfText(buffer: Buffer): Promise<string>;

  // Parse HTML and return cheerio instance
  parseHtml(html: string): CheerioAPI;

  // Fetch with exponential backoff retry
  fetchWithRetry(url: string, options?: RetryOptions): Promise<CachedFetchResult>;
}
```

**Implementation**:

| Provider | File | Use Case | Features |
|----------|------|----------|----------|
| ExtractionProvider | `packages/extraction-provider/src/extraction.provider.ts` | Default | Caching, Rate Limiting, Retry |

**Features**:
- **Rate Limiting**: Token bucket algorithm (configurable requests/second)
- **Caching**: In-memory cache with TTL for repeated requests
- **Retry Logic**: Exponential backoff with jitter for failed requests
- **PDF Extraction**: Uses `pdf-parse` for PDF text extraction
- **HTML Parsing**: Uses `cheerio` for DOM selection and manipulation

**Configuration**:
```bash
# Rate limiting
EXTRACTION_RATE_LIMIT_RPS=2          # Requests per second
EXTRACTION_RATE_LIMIT_BURST=5        # Burst size for token bucket

# Caching
EXTRACTION_CACHE_TTL_MS=300000       # Cache TTL (5 minutes)
EXTRACTION_CACHE_MAX_SIZE=100        # Maximum cached entries

# Timeouts and retries
EXTRACTION_DEFAULT_TIMEOUT_MS=30000  # Request timeout (30 seconds)
EXTRACTION_RETRY_MAX_ATTEMPTS=3      # Maximum retry attempts
EXTRACTION_RETRY_BASE_DELAY_MS=1000  # Base delay for exponential backoff
EXTRACTION_RETRY_MAX_DELAY_MS=30000  # Maximum retry delay
```

**Module Configuration**:
```typescript
// Default configuration
@Module({
  imports: [ExtractionModule],
})
export class AppModule {}

// Custom configuration
@Module({
  imports: [
    ExtractionModule.forRoot({
      config: {
        rateLimit: { requestsPerSecond: 5, burstSize: 10 },
        cache: { ttlMs: 60000, maxSize: 50 },
      },
    }),
  ],
})
export class AppModule {}

// Async configuration with injected dependencies
@Module({
  imports: [
    ExtractionModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: config.get('extraction'),
      }),
    }),
  ],
})
export class AppModule {}
```

**Consumed By**: `TextExtractionService`, Region Providers

---

### 9. Secrets Provider

**Package**: `@qckstrt/secrets-provider`

**Purpose**: Abstract secrets management (Supabase Vault)

**Interface**:
```typescript
export interface ISecretsProvider {
  getName(): string;
  getSecret(secretId: string): Promise<string | undefined>;
  getSecrets(secretIds: string[]): Promise<Record<string, string | undefined>>;
  getSecretJson<T>(secretId: string): Promise<T | undefined>;
}
```

**Implementation**:

| Provider | File | Use Case | Features |
|----------|------|----------|----------|
| Supabase | `packages/secrets-provider/src/providers/supabase-vault.provider.ts` | Default | pgsodium encryption |

**Configuration**:
```bash
# Supabase Vault
SECRETS_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=your-key
```

**Module**: `SecretsModule`

**Note**: Supabase Vault requires the `vault_read_secret` function. See [Supabase Setup Guide](../guides/supabase-setup.md).

---

### 10. HTTP Connection Pool (Common Utility)

**Package**: `@qckstrt/common`

**Purpose**: Provide HTTP connection pooling for external requests using undici, reducing TCP connection overhead and improving performance for repeated HTTP calls.

**Exports**:
```typescript
import {
  HttpPoolManager,        // Class for creating custom pool instances
  HttpPoolConfig,         // Configuration interface
  DEFAULT_HTTP_POOL_CONFIG, // Default configuration values
  getSharedHttpPool,      // Get/create singleton pool instance
  closeSharedHttpPool,    // Gracefully close shared pool
  destroySharedHttpPool,  // Immediately destroy shared pool
  setGlobalHttpPool,      // Set as Node.js global dispatcher
  getGlobalHttpDispatcher, // Get current global dispatcher
  createPooledFetch,      // Create a fetch function bound to a pool
} from '@qckstrt/common';
```

**Configuration**:
```typescript
interface HttpPoolConfig {
  connections?: number;         // Max connections per origin (default: 100)
  pipelining?: number;          // HTTP pipelining factor (default: 10)
  keepAliveTimeoutMs?: number;  // Keep-alive timeout (default: 30000)
  keepAliveMaxTimeoutMs?: number; // Max keep-alive time (default: 600000)
  connectTimeoutMs?: number;    // Connection timeout (default: 30000)
  bodyTimeoutMs?: number;       // Body read timeout (default: 0 = no timeout)
  headersTimeoutMs?: number;    // Headers timeout (default: 0 = no timeout)
}
```

**Usage Patterns**:

1. **Shared Pool (Recommended)** - Single pool instance for entire application:
```typescript
import { getSharedHttpPool } from '@qckstrt/common';

// Get shared pool (creates on first call)
const pool = getSharedHttpPool({ connections: 50 });

// Use pooled fetch
const response = await pool.fetch('https://api.example.com/data');

// On application shutdown
import { closeSharedHttpPool } from '@qckstrt/common';
await closeSharedHttpPool();
```

2. **Global Dispatcher** - Make all Node.js fetch calls use pooling:
```typescript
import { setGlobalHttpPool } from '@qckstrt/common';

// Set once at application startup
setGlobalHttpPool({ connections: 100 });

// All subsequent fetch() calls automatically use pooling
const response = await fetch('https://api.example.com/data');
```

3. **Custom Pool** - Dedicated pool for specific use case:
```typescript
import { HttpPoolManager } from '@qckstrt/common';

const pool = new HttpPoolManager({
  connections: 25,
  pipelining: 5,
  keepAliveTimeoutMs: 60000,
});

const response = await pool.fetch('https://api.example.com/data');

// Clean up when done
await pool.close();
```

4. **Pooled Fetch Function** - Create a standalone fetch bound to a pool:
```typescript
import { createPooledFetch } from '@qckstrt/common';

// Create a fetch function with pooling
const pooledFetch = createPooledFetch({ connections: 50 });

// Use like normal fetch
const response = await pooledFetch('https://api.example.com/data');
```

**Integration with Providers**:

Providers that make external HTTP requests can accept a custom `fetchFn` for connection pooling:

```typescript
import { getSharedHttpPool, ExtractionProvider } from '@qckstrt/common';

// Create extraction provider with pooled fetch
const pool = getSharedHttpPool();
const extractor = new ExtractionProvider({
  fetchFn: pool.fetch.bind(pool),
  // ... other config
});

// Ollama providers also support fetchFn
const llm = new OllamaLLMProvider({
  fetchFn: pool.fetch.bind(pool),
  // ... other config
});
```

**Performance Benefits**:
- **Connection Reuse**: TCP connections are kept alive and reused across requests
- **Reduced Latency**: Eliminates TCP handshake overhead for subsequent requests
- **Resource Efficiency**: Limits maximum connections to prevent resource exhaustion
- **HTTP Pipelining**: Multiple requests can be sent without waiting for responses

**Pool Statistics**:
```typescript
const pool = getSharedHttpPool();
const stats = pool.getStats();
// { connected: 5, free: 3, pending: 0, queued: 0, running: 2, size: 5 }
```

**Graceful Shutdown**:

For Kubernetes/container environments, properly close the pool during shutdown:

```typescript
// In NestJS, add to OnApplicationShutdown
@Injectable()
export class AppShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await closeSharedHttpPool(); // Graceful close
    // Or: await destroySharedHttpPool(); // Immediate destroy
  }
}
```

---

## Benefits of Provider Pattern

### 1. Unified Development Stack
```typescript
// Single command to start everything
// docker-compose up
const provider = process.env.RELATIONAL_DB_PROVIDER || 'postgres';
```

### 2. Easy Testing
```typescript
// Use test database on PostgreSQL
RELATIONAL_DB_DATABASE=qckstrt_test
```

### 3. Consolidated Architecture
```typescript
// Vector DB uses same PostgreSQL instance as relational DB
// Simplifies infrastructure and reduces operational overhead
VECTOR_DB_HOST=${RELATIONAL_DB_HOST}
VECTOR_DB_PORT=${RELATIONAL_DB_PORT}
```

### 4. No Code Changes
```bash
# Configuration changes don't require code changes
# Just update environment variables and restart
```

### 5. Custom Implementations
```typescript
// Add your own provider
class MyCustomDBProvider implements IRelationalDBProvider {
  getName() { return 'MyCustomDB'; }
  // ... implement interface
}

// Register in module
case 'custom':
  return new MyCustomDBProvider(config);
```

## Provider Lifecycle

### 1. Module Initialization
```
Application Startup
  ↓
ConfigModule loads .env
  ↓
Provider Module (e.g., RelationalDBModule)
  ↓
useFactory called with ConfigService
  ↓
Reads RELATIONAL_DB_PROVIDER env var
  ↓
Instantiates correct provider class
  ↓
Provider exported with DI token
```

### 2. Service Injection
```
Service Constructor
  ↓
@Inject('PROVIDER_TOKEN') requests provider
  ↓
NestJS DI resolves provider instance
  ↓
Service uses provider via interface
```

### 3. Runtime Behavior
```
Service calls provider method
  ↓
Provider implementation handles details
  ↓
Service receives standardized response
  ↓
Service doesn't know/care which implementation was used
```

## Provider Selection Logic

### Relational Database
```typescript
// Default to PostgreSQL (via Supabase)
const provider = process.env.RELATIONAL_DB_PROVIDER || 'postgres';
```

### Vector Database
```typescript
// pgvector on PostgreSQL (default)
const dimensions = process.env.VECTOR_DB_DIMENSIONS || 384;
// Uses VECTOR_DB_* or falls back to RELATIONAL_DB_*
```

### Embeddings
```typescript
// Explicit configuration only
const provider = process.env.EMBEDDINGS_PROVIDER || 'xenova';
```

### LLM
```typescript
// Ollama only (model is configurable)
const url = process.env.LLM_URL || 'http://localhost:11434';
const model = process.env.LLM_MODEL || 'falcon';
```

## Adding a New Provider

### Step 1: Implement Interface
```typescript
// packages/[type]-provider/src/providers/my-provider.provider.ts
export class MyProvider implements IProviderInterface {
  constructor(private config: MyProviderConfig) {}

  // Implement all interface methods
  getName(): string { return 'MyProvider'; }
  // ...
}
```

### Step 2: Add to Module
```typescript
// packages/[type]-provider/src/[type].module.ts
useFactory: (config: ConfigService) => {
  const provider = config.get('provider.type');

  switch (provider) {
    case 'my-provider':
      return new MyProvider(/* config */);
    // ... other cases
  }
}
```

### Step 3: Export from Index
```typescript
// packages/[type]-provider/src/index.ts
export * from './providers/my-provider.provider';
```

### Step 4: Document
```typescript
// Add configuration example
// Add to README.md
// Update migration guide if applicable
```

## Error Handling

### Provider Initialization Errors
```typescript
useFactory: (config: ConfigService) => {
  try {
    const provider = createProvider(config);
    return provider;
  } catch (error) {
    throw new Error(`Failed to initialize provider: ${error.message}`);
  }
}
```

### Runtime Errors
```typescript
export class LLMError extends Error {
  constructor(
    public provider: string,
    public operation: string,
    public originalError: Error
  ) {
    super(`LLM operation '${operation}' failed in ${provider}: ${originalError.message}`);
    this.name = 'LLMError';
  }
}
```

### Availability Checks
```typescript
async isAvailable(): Promise<boolean> {
  try {
    // Provider-specific health check
    return await this.healthCheck();
  } catch (error) {
    this.logger.error('Availability check failed:', error);
    return false;
  }
}
```

## Best Practices

### 1. Interface-First Design
- Define interface before implementations
- Keep interfaces minimal and focused
- Use TypeScript for type safety

### 2. Configuration Over Code
- All provider selection via environment variables
- Sensible defaults for development
- Document all configuration options

### 3. Logging
- Log provider selection at startup
- Log provider operations (debug level)
- Log errors with context

### 4. Testing
- Test each provider implementation independently
- Test provider switching logic
- Test error handling

### 5. Documentation
- Document each provider's pros/cons
- Provide configuration examples
- Include migration guides

---

**Related Documentation**:
- [Data Layer Architecture](data-layer.md) - Database provider details
- [AI/ML Pipeline](ai-ml-pipeline.md) - Embeddings and LLM providers
- [Database Migration Guide](../guides/database-migration.md) - Switching providers
- [Supabase Setup Guide](../guides/supabase-setup.md) - OSS alternative setup

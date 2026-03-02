# @opuspopuli/prompt-client

Database-backed prompt template client for AI-powered features. Reads prompt templates from PostgreSQL, composes them with variables, and optionally delegates to a remote [AI Prompt Service](https://github.com/OpusPopuli/prompt-service) with HMAC authentication, circuit breaker protection, and retry logic.

## Features

- **Database templates** — reads prompt templates from PostgreSQL via Prisma
- **Remote delegation** — optionally delegates to a remote AI Prompt Service
- **HMAC authentication** — signs requests using HMAC-SHA256 for federated node auth
- **Circuit breaker** — prevents cascading failures when prompt-service is down
- **Retry with backoff** — handles transient network/server errors
- **TTL-based caching** — pluggable `ICache<T>` interface (MemoryCache default, Redis optional)
- **3-tier fallback** — remote service → database → hardcoded defaults
- **Metrics** — cache hit rate, fallback rate, remote latency, circuit breaker state

## Installation

```bash
pnpm add @opuspopuli/prompt-client
```

## Quick Start

### Local mode (database templates)

```typescript
import { Module } from '@nestjs/common';
import { PromptClientModule } from '@opuspopuli/prompt-client';

@Module({
  imports: [PromptClientModule],
})
export class AppModule {}
```

### Remote mode (with AI Prompt Service)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PromptClientModule } from '@opuspopuli/prompt-client';

@Module({
  imports: [
    PromptClientModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
          promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
          hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

## Usage

```typescript
import { Injectable } from '@nestjs/common';
import { PromptClientService } from '@opuspopuli/prompt-client';

@Injectable()
export class MyService {
  constructor(private readonly promptClient: PromptClientService) {}

  async analyzeDocument(text: string) {
    const { promptText, promptHash, promptVersion } =
      await this.promptClient.getDocumentAnalysisPrompt({
        documentType: 'petition',
        text,
      });
    // Use promptText with your LLM provider
  }

  async answerQuestion(context: string, query: string) {
    const { promptText } = await this.promptClient.getRAGPrompt({
      context,
      query,
    });
    // Use promptText with your LLM provider
  }

  async extractStructure(html: string) {
    const { promptText } = await this.promptClient.getStructuralAnalysisPrompt({
      dataType: 'propositions',
      contentGoal: 'Extract ballot measures',
      html,
    });
    // Use promptText with your LLM provider
  }
}
```

## Configuration

All configuration fields are optional with sensible defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `promptServiceUrl` | `undefined` | Remote prompt service URL (undefined = local DB mode) |
| `promptServiceApiKey` | `undefined` | API key for Bearer auth or HMAC signing |
| `hmacNodeId` | `undefined` | Node UUID — enables HMAC auth when set (instead of Bearer) |
| `timeoutMs` | `10000` | Request timeout for remote calls |
| `retryMaxAttempts` | `3` | Max retry attempts for transient errors |
| `retryBaseDelayMs` | `1000` | Base delay for exponential backoff |
| `retryMaxDelayMs` | `10000` | Maximum delay between retries |
| `circuitBreakerFailureThreshold` | `3` | Failures before opening circuit |
| `circuitBreakerHalfOpenMs` | `15000` | Time before testing half-open |
| `cache` | `MemoryCache` | Custom `ICache<PromptTemplate>` (e.g., Redis-backed) |
| `cacheTtlMs` | `300000` | Cache TTL in ms (5 minutes) |
| `cacheMaxSize` | `50` | Max entries in built-in MemoryCache |

### Environment Variables

```bash
# Remote AI Prompt Service (all optional)
PROMPT_SERVICE_URL='http://localhost:3200'
PROMPT_SERVICE_API_KEY='your-api-key'
PROMPT_SERVICE_NODE_ID='node-uuid'      # Enables HMAC auth when set
```

## Authentication Modes

### Bearer Token (default when URL + API key set)

Standard `Authorization: Bearer <key>` header. Simple, suitable for trusted internal networks.

### HMAC Signing (when `hmacNodeId` is also set)

Cryptographic request signing for federated node authentication:

```
X-HMAC-Signature: HMAC-SHA256(apiKey, "${timestamp}\n${method}\n${path}\n${bodyHash}")
X-HMAC-Timestamp: <unix-seconds>
X-HMAC-Key-Id: <nodeId>
```

This protocol matches the [prompt-service HMAC validation](https://github.com/OpusPopuli/prompt-service) and provides:
- **Replay protection** via timestamp validation (5-minute window)
- **Tamper detection** via body hash in signature
- **Key rotation** via the key ID header

## Resilience Architecture

```
Request
  │
  ├─ Cache hit? ──────────────────────────── Return cached template
  │
  ├─ Remote URL configured?
  │   │
  │   └─ withRetry() ──► CircuitBreaker ──► fetch(HMAC/Bearer)
  │       │                   │
  │       │ retry on 5xx/     │ open after N failures
  │       │ network errors    │ fail fast with CircuitOpenError
  │       │                   │
  │       └── on failure ─────┴──► composeFromDb()
  │                                    │
  │                                    ├─ DB template found? ── Return
  │                                    └─ Hardcoded fallback ── Return (v0)
  │
  └─ Local mode (no URL)
      │
      └─ composeFromDb() ──► DB or hardcoded fallback
```

### Circuit Breaker States

| State | Behavior |
|-------|----------|
| **Closed** | Requests pass through normally |
| **Open** | Requests fail fast, fall back to DB immediately |
| **Half-Open** | One test request allowed; success resets, failure re-opens |

## Monitoring

### Metrics

```typescript
const metrics = promptClient.getMetrics();
// {
//   totalRequests: 150,
//   cacheHits: 80,
//   remoteCalls: 50,
//   dbFallbacks: 15,
//   hardcodedFallbacks: 5,
//   avgRemoteLatencyMs: 45,
//   circuitBreakerState: 'closed',
//   cacheHitRate: 0.53,
//   fallbackRate: 0.13,
// }
```

### Circuit Breaker Health

```typescript
const health = promptClient.getCircuitBreakerHealth();
// {
//   serviceName: 'PromptService',
//   state: 'closed',
//   isHealthy: true,
//   failureCount: 0,
//   lastFailureTime: null,
// }
```

## Prompt Types

| Method | Template(s) | Use Case |
|--------|-------------|----------|
| `getStructuralAnalysisPrompt()` | `structural-analysis`, `structural-schema-*` | Web scraping schema extraction |
| `getDocumentAnalysisPrompt()` | `document-analysis-*`, `document-analysis-base-instructions` | Document AI analysis |
| `getRAGPrompt()` | `rag` | Retrieval-augmented generation |

## Testing

```bash
pnpm test           # Run all tests
pnpm test --coverage # With coverage report
```

## License

AGPL-3.0

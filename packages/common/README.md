# @opuspopuli/common

Shared types, interfaces, and utilities for the [Opus Populi](https://github.com/OpusPopuli/opuspopuli) platform.

This package provides the core abstractions that allow pluggable provider implementations across the platform. All provider packages (`@opuspopuli/llm-provider`, `@opuspopuli/extraction-provider`, etc.) implement the interfaces defined here.

## Installation

```bash
npm install @opuspopuli/common --registry https://npm.pkg.github.com
```

## Provider Modules

### AI & Data Processing

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **LLM** | `ILLMProvider`, `ChatMessage`, `GenerateOptions`, `GenerateResult` | Language model interface for chat completions |
| **Embeddings** | `IEmbeddingProvider`, `EmbeddingResult`, `ChunkingConfig` | Text embedding generation |
| **OCR** | `IOcrProvider`, `OcrResult`, `OcrTextBlock` | Optical character recognition |
| **Extraction** | `ITextExtractor`, `TextExtractionResult` | Text extraction from documents |

### Data Storage

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **VectorDB** | `IVectorDBProvider`, `IVectorDocument`, `IVectorQueryResult` | Vector database operations |
| **RelationalDB** | `IRelationalDBProvider`, `RelationalDBType` | ORM-agnostic relational database interface |
| **Storage** | `IStorageProvider`, `IStorageFile`, `ISignedUrlOptions` | File/object storage (S3-compatible) |

### Platform Services

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **Auth** | `IAuthProvider`, `IAuthResult`, `IRegisterUserInput` | Authentication and user management |
| **Secrets** | `ISecretsProvider`, `ISecretsConfig` | Secrets management (env vars, vaults) |
| **Email** | `IEmailProvider`, `ISendEmailOptions`, `IEmailResult` | Email sending |
| **Logging** | `ILoggingProvider`, `LogLevel`, `ILogEntry` | Structured logging |

### Civic Data (Region Plugins)

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **Region** | `IRegionProvider`, `RegionInfo`, `Proposition`, `Meeting`, `Representative` | Civic data types and region provider interface |
| | `Committee`, `Contribution`, `Expenditure`, `IndependentExpenditure` | Campaign finance domain models |
| | `CommitteeType`, `DataType`, `PropositionStatus`, `ContactInfo`, `SyncResult`, `RegionError` | Enums and supporting types |

### Scraping Pipeline

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **Scraping Pipeline** | `DeclarativeRegionConfig`, `DataSourceConfig`, `BulkDownloadConfig`, `ApiSourceConfig` | Declarative region config types |
| | `ExtractionResult`, `RawExtractionResult`, `StructuralManifest`, `IPipelineService` | Pipeline interfaces and result types |

### Config Utilities

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **Config** | `resolveConfigPlaceholders()` | Resolve `${variableName}` placeholders in config objects |

### Infrastructure Utilities

| Module | Key Exports | Description |
|--------|-------------|-------------|
| **Rate Limiting** | `RateLimiter`, `IRateLimiter`, `RateLimitOptions` | Token bucket rate limiter |
| **Retry** | `withRetry()`, `RetryPredicates`, `calculateDelay()`, `RetryConfig` | Exponential backoff with jitter |
| **Caching** | `MemoryCache<T>`, `ICache<T>`, `CacheOptions` | In-memory cache with TTL and LRU eviction |
| **Resilience** | `CircuitBreakerManager`, `createCircuitBreaker()`, `CircuitBreakerConfig` | Circuit breaker pattern |
| **HTTP** | `HttpPoolManager`, `getSharedHttpPool()`, `createPooledFetch()` | HTTP connection pooling via undici |

## Usage

```typescript
import {
  // Provider interfaces
  ILLMProvider,
  IVectorDBProvider,

  // Civic data types
  Proposition,
  Meeting,
  Representative,
  DataType,

  // Campaign finance types
  Committee,
  Contribution,
  Expenditure,
  IndependentExpenditure,

  // Config types and utilities
  DeclarativeRegionConfig,
  DataSourceConfig,
  resolveConfigPlaceholders,

  // Infrastructure utilities
  RateLimiter,
  withRetry,
  RetryPredicates,
  MemoryCache,
  createCircuitBreaker,
} from "@opuspopuli/common";
```

## Sub-path Imports

Individual modules can be imported directly for tree-shaking:

```typescript
import { ILLMProvider } from "@opuspopuli/common/providers/llm";
import { HttpPoolManager } from "@opuspopuli/common/providers/http";
```

## License

AGPL-3.0

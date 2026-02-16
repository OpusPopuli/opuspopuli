# Backend Testing Guide

This guide covers the testing strategy and practices for the Opus Populi backend services.

## Overview

The backend uses a layered testing approach:

| Test Type | Framework | Purpose |
|-----------|-----------|---------|
| **Unit Tests** | Jest | Individual functions, services, controllers |
| **Integration Tests** | Jest + Docker Compose | Full service stack with real dependencies |

## Test Structure

```
apps/backend/
├── src/
│   └── **/*.spec.ts           # Unit tests (co-located with source)
├── __tests__/
│   ├── jest-integration.json  # Integration test config
│   └── integration/
│       ├── setup.ts           # Global setup (verify services)
│       ├── teardown.ts        # Global teardown
│       ├── test-utils.ts      # Shared utilities
│       └── health/
│           └── health.integration.spec.ts
└── jest.config.ts             # Unit test config
```

## Running Tests

### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Watch mode
pnpm test:watch

# Run specific test file
pnpm test -- audit-log.service.spec.ts
```

### Integration Tests

Integration tests run against real services (Supabase, PostgreSQL, Redis, etc.) inside Docker.

```bash
# Option A: Fully containerized (recommended — matches CI)
pnpm test:integration:docker

# Option B: Manual steps
docker compose -f docker-compose-integration.yml up -d --build
docker compose -f docker-compose-integration.yml ps          # Wait for all services to be healthy
pnpm test:integration
docker compose -f docker-compose-integration.yml down -v     # Cleanup
```

> **Note:** `docker-compose-integration.yml` includes infrastructure + all backend microservices.
> See [Docker Setup](docker-setup.md) for the full compose file architecture.

## Unit Testing

### Configuration

Unit tests use the main `jest.config.ts` which excludes integration tests:

```typescript
// apps/backend/jest.config.ts
testPathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  String.raw`.*\.integration\.spec\.ts$`,  // Exclude integration tests
],
```

### Writing Unit Tests

Unit tests are co-located with source files:

```typescript
// src/common/services/audit-log.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLogEntity), useValue: mockRepository },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  it('should create audit log entry', async () => {
    const result = await service.create({ /* ... */ });
    expect(result).toBeDefined();
  });
});
```

### Mocking Dependencies

```typescript
// Mock repository
const mockRepository = {
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
};

// Mock ConfigService
const mockConfigService = {
  get: jest.fn((key: string) => {
    const config = { AUDIT_RETENTION_DAYS: '90' };
    return config[key];
  }),
};
```

## Integration Testing

### Configuration

Integration tests use a separate Jest config:

```json
// apps/backend/__tests__/jest-integration.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testMatch": ["**/*.integration.spec.ts"],
  "transform": { "^.+\\.ts$": "ts-jest" },
  "globalSetup": "<rootDir>/__tests__/integration/setup.ts",
  "globalTeardown": "<rootDir>/__tests__/integration/teardown.ts",
  "testTimeout": 60000,
  "maxWorkers": 1
}
```

### Global Setup

The setup verifies infrastructure and backend services are running:

```typescript
// apps/backend/__tests__/integration/setup.ts
export default async function globalSetup() {
  // Verify infrastructure services (from docker-compose-integration.yml)
  execSync('docker compose ps --status running | grep supabase-db');

  // Verify backend services are running
  // Checks: users (3001), documents (3002), knowledge (3003), region (3004)
  // Optional: api gateway (3000)
}
```

### Writing Integration Tests

Integration tests connect to real services:

```typescript
// apps/backend/__tests__/integration/health/health.integration.spec.ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createIntegrationApp } from '../test-utils';
import { UsersAppModule } from 'src/apps/users/src/app.module';

describe('Health Check (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createIntegrationApp(UsersAppModule);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('should return healthy status', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
  });

  it('should connect to real database', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.details.database.status).toBe('up');
  });
});
```

### Test Utilities

```typescript
// apps/backend/__tests__/integration/test-utils.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';

export async function createIntegrationApp(AppModule: any): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export async function getMagicLinkFromInbucket(email: string): Promise<string | null> {
  const mailbox = email.split('@')[0];
  const response = await fetch(`http://localhost:54324/api/v1/mailbox/${mailbox}`);
  const emails = await response.json();
  // Extract magic link from latest email...
}
```

## Backend Services

Integration tests target the backend services running in Docker via `docker-compose-integration.yml`:

| Service | Port | Docker Container |
|---------|------|-----------------|
| Users | 3001 | `opuspopuli-integration-users` |
| Documents | 3002 | `opuspopuli-integration-documents` |
| Knowledge | 3003 | `opuspopuli-integration-knowledge` |
| Region | 3004 | `opuspopuli-integration-region` |
| API Gateway | 3000 | `opuspopuli-integration-api` |

> For local development without Docker, you can also run services directly:
> ```bash
> cd apps/backend && pnpm start  # Starts all services + API gateway
> ```

## CI/CD Integration

Integration tests run as part of the E2E job in `ci.yml`. A separate `integration-tests.yml` workflow is available for manual debugging.

### How It Works in CI

1. `docker compose -f docker-compose-integration.yml` (or `-e2e.yml`) starts all infrastructure + microservices
2. The `--profile test` flag activates the `test-runner` container which runs integration tests inside Docker
3. All services share the `opuspopuli-network` for container-to-container communication

```yaml
# .github/workflows/integration-tests.yml (manual trigger)
- name: Start all services
  run: |
    docker compose -f docker-compose-integration.yml up -d --build --wait --wait-timeout 600 \
      supabase-db redis inbucket db-migrate users documents knowledge region api

- name: Run integration tests
  run: |
    docker compose -f docker-compose-integration.yml --profile test run --rm test-runner

- name: Stop all services
  if: always()
  run: docker compose -f docker-compose-integration.yml --profile test down -v
```

### Separate from Unit Tests

- **Unit tests** run in `ci.yml` (fast, no external deps)
- **Integration tests** run in `ci.yml` E2E job and `integration-tests.yml` (slower, fully containerized)

## Coverage Requirements

### Unit Test Thresholds

Coverage is collected during unit tests:

```bash
pnpm test -- --coverage
```

Coverage reports are uploaded to SonarCloud in CI.

### Excluded from Coverage

- `src/db/migrations/` - Generated migration files
- `src/db/entities/` - Entity definitions
- `main.ts` - Bootstrap files
- `*.dto.ts` - Data transfer objects (type definitions)

## Debugging Tests

### Unit Tests

```bash
# Verbose output
pnpm test -- --verbose

# Run single test file
pnpm test -- graphql-audit.interceptor.spec.ts

# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Integration Tests

```bash
# Check if services are running
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
curl http://localhost:3000/health

# View captured emails (Inbucket)
open http://localhost:54324

# Check service logs
docker compose -f docker-compose-integration.yml logs -f supabase-db
docker compose -f docker-compose-integration.yml logs -f api
```

## Best Practices

### Unit Tests

1. **Mock external dependencies** - Database, HTTP clients, etc.
2. **Test one thing per test** - Clear, focused assertions
3. **Use meaningful test names** - "should create audit log when mutation succeeds"
4. **Co-locate with source** - `foo.service.ts` → `foo.service.spec.ts`

### Integration Tests

1. **Test real workflows** - Register → Login → Query
2. **Use unique test data** - Avoid conflicts between parallel tests
3. **Clean up after tests** - Delete test users, documents, etc.
4. **Handle timeouts gracefully** - Services may take time to start

### Naming Conventions

- Unit tests: `*.spec.ts`
- Integration tests: `*.integration.spec.ts`

## Related Documentation

- [Frontend Testing Guide](frontend-testing.md)
- [Docker Setup](docker-setup.md)
- [Getting Started](getting-started.md)

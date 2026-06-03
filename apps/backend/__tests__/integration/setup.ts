import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { ensureTestDatabase } from './utils/test-db-bootstrap';

// Load environment variables from .env file (only needed when running from host)
config({ path: resolve(__dirname, '../../.env') });

/**
 * Workspace package that owns the Prisma schema + migrations. We shell out
 * to its bin so we get the locally-pinned Prisma 5 client (the root has a
 * Prisma 7 binary that doesn't understand this schema). See #796.
 */
const RELATIONALDB_PROVIDER_PACKAGE = '@opuspopuli/relationaldb-provider';

/**
 * Swap DATABASE_URL to point at `postgres_test`, create the DB if it doesn't
 * exist, and apply pending migrations. Runs once per `pnpm test:integration`
 * invocation, before any worker process imports the Prisma client. Pairs
 * with the `assertTestDatabase` guard in utils/db-cleanup.ts — together
 * they make it impossible for integration tests to touch the dev DB.
 */
async function bootstrapTestDatabase(): Promise<void> {
  const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
  if (!integrationUrl) {
    throw new Error(
      'INTEGRATION_DATABASE_URL is not set. Copy the value from ' +
        'apps/backend/.env.example into apps/backend/.env. See #796.',
    );
  }
  if (!/\/[A-Za-z0-9_]*_test([?#/]|$)/.test(integrationUrl)) {
    throw new Error(
      'INTEGRATION_DATABASE_URL must end in a *_test database name to be ' +
        'eligible for cleanDatabase() — refusing to bootstrap. ' +
        `Got: ${integrationUrl}`,
    );
  }
  await ensureTestDatabase();
  // Swap BEFORE any test worker imports the Prisma client. Every downstream
  // import (DbService, helpers, the assertTestDatabase guard) reads this
  // value at module load time.
  process.env.DATABASE_URL = integrationUrl;

  // execSync inherits process.env, which we just updated above. No need
  // to pass `env:` explicitly — that path collides with the dotenv-loaded
  // PORT (number) vs. ProcessEnv (string) type expectations.
  execSync(
    `pnpm --filter ${RELATIONALDB_PROVIDER_PACKAGE} exec prisma migrate deploy`,
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  console.log('✓ postgres_test bootstrapped + migrations applied');
}

interface ServiceConfig {
  name: string;
  url: string;
  required: boolean;
}

/**
 * Get service URLs from environment variables or fall back to localhost defaults.
 * When running in Docker, env vars point to container names (e.g., http://users:8080).
 * When running from host, they default to localhost with mapped ports.
 */
function getServiceConfigs(): ServiceConfig[] {
  return [
    {
      name: 'users',
      url: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
      required: true,
    },
    {
      name: 'documents',
      url: process.env.DOCUMENTS_SERVICE_URL || 'http://localhost:3002',
      required: true,
    },
    {
      name: 'knowledge',
      url: process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3003',
      required: true,
    },
    {
      name: 'region',
      url: process.env.REGION_SERVICE_URL || 'http://localhost:3004',
      required: true,
    },
    {
      name: 'api',
      url: process.env.API_GATEWAY_URL || 'http://localhost:3000',
      required: true, // API Gateway is now required for all tests
    },
  ];
}

async function checkService(service: ServiceConfig): Promise<boolean> {
  try {
    const response = await fetch(`${service.url}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  // Bootstrap the isolated test database BEFORE anything else so every
  // downstream module sees DATABASE_URL pointed at postgres_test. See #796.
  await bootstrapTestDatabase();

  const services = getServiceConfigs();

  // When running inside Docker, skip docker compose check
  const isRunningInDocker = process.env.API_GATEWAY_URL?.includes('://api:');

  if (!isRunningInDocker) {
    // Verify docker-compose services are running (only when running from host)
    try {
      execSync('docker compose ps --status running | grep opuspopuli-db', {
        stdio: 'pipe',
      });
    } catch {
      throw new Error(
        'Integration tests require docker-compose services.\n' +
          'Run: docker compose up -d',
      );
    }
  }

  console.log('✓ Docker services running');

  // Verify backend services are running
  const maxWait = 60000; // 60 seconds
  const startTime = Date.now();
  const requiredServices = services.filter((s: ServiceConfig) => s.required);

  while (Date.now() - startTime < maxWait) {
    const serviceStatuses = await Promise.all(
      requiredServices.map(async (service: ServiceConfig) => ({
        ...service,
        ready: await checkService(service),
      })),
    );

    const allReady = serviceStatuses.every((s) => s.ready);

    if (allReady) {
      for (const service of serviceStatuses) {
        console.log(`✓ ${service.name} service ready (${service.url})`);
      }

      return;
    }

    // Show progress
    const readyCount = serviceStatuses.filter((s) => s.ready).length;
    const notReady = serviceStatuses
      .filter((s) => !s.ready)
      .map((s) => s.name)
      .join(', ');
    console.log(
      `Waiting for services... (${readyCount}/${requiredServices.length} ready, waiting for: ${notReady})`,
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Timeout - show which services are missing
  const finalStatuses = await Promise.all(
    requiredServices.map(async (service: ServiceConfig) => ({
      ...service,
      ready: await checkService(service),
    })),
  );

  const missing = finalStatuses.filter((s) => !s.ready);
  const missingList = missing.map((s) => `  - ${s.name} (${s.url})`).join('\n');

  throw new Error(
    `Backend services not running. Missing services:\n${missingList}\n\n` +
      'To start all services:\n' +
      '  docker compose -f docker-compose-integration.yml up -d\n\n' +
      'Or run tests in Docker:\n' +
      '  docker compose -f docker-compose-integration.yml --profile test run test-runner',
  );
}

import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load environment variables from .env file (only needed when running from host)
config({ path: resolve(__dirname, '../../.env') });

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

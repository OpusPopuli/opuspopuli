/**
 * Service Health Check Utilities
 *
 * Provides helpers to verify services are healthy before running integration tests.
 * Useful for tests that require specific services to be available.
 */
import { SERVICE_URLS } from './test-context';

/**
 * Health check result for a single service
 */
export interface ServiceHealthResult {
  service: string;
  healthy: boolean;
  responseTime?: number;
  error?: string;
}

/**
 * Check if a service is healthy by hitting its health endpoint
 */
export async function checkServiceHealth(
  serviceName: keyof typeof SERVICE_URLS,
  timeoutMs: number = 5000,
): Promise<ServiceHealthResult> {
  const url = SERVICE_URLS[serviceName];
  const healthEndpoint = serviceName === 'api' ? '/health' : '/health';
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${url}${healthEndpoint}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      service: serviceName,
      healthy: response.ok,
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      service: serviceName,
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check health of all services
 */
export async function checkAllServicesHealth(
  timeoutMs: number = 5000,
): Promise<ServiceHealthResult[]> {
  const services = Object.keys(SERVICE_URLS) as Array<
    keyof typeof SERVICE_URLS
  >;
  return Promise.all(services.map((s) => checkServiceHealth(s, timeoutMs)));
}

/**
 * Wait for a service to become healthy with retries
 */
export async function waitForServiceHealth(
  serviceName: keyof typeof SERVICE_URLS,
  options: {
    maxRetries?: number;
    retryIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const { maxRetries = 30, retryIntervalMs = 1000, timeoutMs = 5000 } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await checkServiceHealth(serviceName, timeoutMs);
    if (result.healthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }

  return false;
}

/**
 * Wait for all services to become healthy
 */
export async function waitForAllServicesHealth(
  options: {
    maxRetries?: number;
    retryIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const services = Object.keys(SERVICE_URLS) as Array<
    keyof typeof SERVICE_URLS
  >;

  for (const service of services) {
    const healthy = await waitForServiceHealth(service, options);
    if (!healthy) {
      console.warn(`Service ${service} did not become healthy`);
      return false;
    }
  }

  return true;
}

/**
 * Skip test if required service is not available
 */
export function skipIfServiceUnavailable(
  serviceName: keyof typeof SERVICE_URLS,
): () => Promise<void> {
  return async () => {
    const result = await checkServiceHealth(serviceName);
    if (!result.healthy) {
      console.log(`Skipping: ${serviceName} service not available`);
      return;
    }
  };
}

/**
 * Get availability status of all services (for test setup logging)
 */
export async function logServiceStatus(): Promise<void> {
  const results = await checkAllServicesHealth();
  console.log('\nService Status:');
  for (const result of results) {
    const status = result.healthy ? '✓' : '✗';
    const time = result.responseTime ? `${result.responseTime}ms` : 'N/A';
    const error = result.error ? ` (${result.error})` : '';
    console.log(`  ${status} ${result.service}: ${time}${error}`);
  }
  console.log();
}

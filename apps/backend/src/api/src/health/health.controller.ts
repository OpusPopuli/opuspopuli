import { Controller, Get } from '@nestjs/common';

/**
 * Circuit breaker status for a service
 */
interface CircuitBreakerStatus {
  /** Service name */
  service: string;
  /** Current state: closed (healthy), open (failing), half_open (testing) */
  state: 'closed' | 'open' | 'half_open';
  /** Whether the service is healthy */
  isHealthy: boolean;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  circuitBreakers?: CircuitBreakerStatus[];
}

/**
 * Health Controller
 *
 * Provides health check endpoints for the API gateway.
 * In a federated architecture, each microservice exposes its own health endpoint
 * with circuit breaker status for its external dependencies.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/198
 */
@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  /**
   * Basic health check endpoint
   *
   * Returns the overall health status of the API gateway.
   * For detailed circuit breaker status, check individual microservice health endpoints.
   */
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '0.0.0',
      // Circuit breaker status is exposed by individual microservices
      // that use external services (Ollama, Supabase, Extraction)
      circuitBreakers: [],
    };
  }
}

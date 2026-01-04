import { registerAs } from '@nestjs/config';

/**
 * Circuit Breaker Configuration
 *
 * Configures circuit breaker settings for external service resilience.
 * Each service has its own threshold and recovery time based on its characteristics.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/198
 */
export interface ICircuitBreakerConfig {
  /** Enable circuit breaker logging */
  enableLogging: boolean;
  /** Service-specific configurations */
  services: {
    /** Ollama LLM - local service, faster recovery */
    ollama: {
      failureThreshold: number;
      halfOpenAfterMs: number;
    };
    /** Supabase Auth - cloud service, moderate threshold */
    supabase: {
      failureThreshold: number;
      halfOpenAfterMs: number;
    };
    /** Extraction - external URLs, higher threshold, longer recovery */
    extraction: {
      failureThreshold: number;
      halfOpenAfterMs: number;
    };
  };
}

export default registerAs(
  'circuitBreaker',
  (): ICircuitBreakerConfig => ({
    enableLogging: process.env.CIRCUIT_BREAKER_LOGGING !== 'false',
    services: {
      ollama: {
        failureThreshold: Number.parseInt(
          process.env.CIRCUIT_BREAKER_OLLAMA_FAILURES || '3',
          10,
        ),
        halfOpenAfterMs: Number.parseInt(
          process.env.CIRCUIT_BREAKER_OLLAMA_RECOVERY_MS || '30000',
          10,
        ),
      },
      supabase: {
        failureThreshold: Number.parseInt(
          process.env.CIRCUIT_BREAKER_SUPABASE_FAILURES || '5',
          10,
        ),
        halfOpenAfterMs: Number.parseInt(
          process.env.CIRCUIT_BREAKER_SUPABASE_RECOVERY_MS || '10000',
          10,
        ),
      },
      extraction: {
        failureThreshold: Number.parseInt(
          process.env.CIRCUIT_BREAKER_EXTRACTION_FAILURES || '5',
          10,
        ),
        halfOpenAfterMs: Number.parseInt(
          process.env.CIRCUIT_BREAKER_EXTRACTION_RECOVERY_MS || '60000',
          10,
        ),
      },
    },
  }),
);

/**
 * Resilience Types
 *
 * Types and interfaces for circuit breaker and resilience patterns.
 */

/**
 * Circuit breaker state
 */
export enum CircuitState {
  /** Circuit is closed - requests flow normally */
  CLOSED = "closed",
  /** Circuit is open - requests are blocked */
  OPEN = "open",
  /** Circuit is testing - limited requests allowed */
  HALF_OPEN = "half_open",
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying half-open */
  halfOpenAfterMs: number;
  /** Service name for logging */
  serviceName: string;
}

/**
 * Circuit breaker health status
 */
export interface CircuitBreakerHealth {
  /** Service name */
  serviceName: string;
  /** Current circuit state */
  state: CircuitState;
  /** Whether the circuit is healthy (closed or half-open) */
  isHealthy: boolean;
  /** Number of consecutive failures */
  failureCount: number;
  /** Last failure timestamp if any */
  lastFailure?: Date;
  /** Last success timestamp if any */
  lastSuccess?: Date;
}

/**
 * Circuit breaker event types
 */
export type CircuitBreakerEvent =
  | "break"
  | "reset"
  | "half_open"
  | "success"
  | "failure";

/**
 * Circuit breaker event listener
 */
export type CircuitBreakerListener = (event: CircuitBreakerEvent) => void;

/**
 * Default configurations for different service types
 */
export const DEFAULT_CIRCUIT_CONFIGS: Record<string, CircuitBreakerConfig> = {
  /** Ollama LLM - faster recovery, lower threshold (local service) */
  ollama: {
    failureThreshold: 3,
    halfOpenAfterMs: 30000, // 30 seconds
    serviceName: "Ollama",
  },
  /** Supabase Auth - moderate threshold, fast recovery (cloud service) */
  supabase: {
    failureThreshold: 5,
    halfOpenAfterMs: 10000, // 10 seconds
    serviceName: "Supabase",
  },
  /** Extraction - higher threshold, longer recovery (external URLs) */
  extraction: {
    failureThreshold: 5,
    halfOpenAfterMs: 60000, // 60 seconds
    serviceName: "Extraction",
  },
};

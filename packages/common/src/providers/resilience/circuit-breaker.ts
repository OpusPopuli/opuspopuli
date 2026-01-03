/**
 * Circuit Breaker Utility
 *
 * Wraps cockatiel's circuit breaker for consistent usage across providers.
 * Prevents cascading failures when external services are down.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/198
 */

import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  handleAll,
  circuitBreaker,
  BrokenCircuitError,
  TaskCancelledError,
  CircuitState as CockatielCircuitState,
} from "cockatiel";
import {
  CircuitBreakerConfig,
  CircuitBreakerHealth,
  CircuitState,
  CircuitBreakerListener,
  CircuitBreakerEvent,
} from "./types.js";

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly originalError?: Error,
  ) {
    super(`Circuit breaker open for ${serviceName} - service unavailable`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Circuit Breaker Manager
 *
 * Creates and manages circuit breakers for external service calls.
 * Provides health monitoring and event notification.
 */
export class CircuitBreakerManager {
  private readonly policy: CircuitBreakerPolicy;
  private readonly config: CircuitBreakerConfig;
  private readonly listeners: Set<CircuitBreakerListener> = new Set();
  private failureCount = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;

    // Create the circuit breaker policy
    this.policy = circuitBreaker(handleAll, {
      halfOpenAfter: config.halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(config.failureThreshold),
    });

    // Set up event listeners
    this.policy.onBreak(() => {
      this.notifyListeners("break");
    });

    this.policy.onReset(() => {
      this.failureCount = 0;
      this.notifyListeners("reset");
    });

    this.policy.onHalfOpen(() => {
      this.notifyListeners("half_open");
    });

    this.policy.onSuccess(() => {
      this.lastSuccess = new Date();
      this.failureCount = 0;
      this.notifyListeners("success");
    });

    this.policy.onFailure(() => {
      this.lastFailure = new Date();
      this.failureCount++;
      this.notifyListeners("failure");
    });
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - Async function to execute
   * @returns Result of the function
   * @throws CircuitOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.policy.execute(fn);
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new CircuitOpenError(this.config.serviceName, error);
      }
      if (error instanceof TaskCancelledError) {
        throw new CircuitOpenError(this.config.serviceName, error);
      }
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    const state = this.policy.state;
    switch (state) {
      case CockatielCircuitState.Closed:
        return CircuitState.CLOSED;
      case CockatielCircuitState.Open:
      case CockatielCircuitState.Isolated:
        return CircuitState.OPEN;
      case CockatielCircuitState.HalfOpen:
        return CircuitState.HALF_OPEN;
      default:
        return CircuitState.CLOSED;
    }
  }

  /**
   * Get health status of the circuit breaker
   */
  getHealth(): CircuitBreakerHealth {
    const state = this.getState();
    return {
      serviceName: this.config.serviceName,
      state,
      isHealthy: state !== CircuitState.OPEN,
      failureCount: this.failureCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
    };
  }

  /**
   * Check if circuit is healthy (not open)
   */
  isHealthy(): boolean {
    return this.getState() !== CircuitState.OPEN;
  }

  /**
   * Add event listener
   */
  addListener(listener: CircuitBreakerListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeListener(listener: CircuitBreakerListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get the underlying policy (for advanced usage)
   */
  getPolicy(): CircuitBreakerPolicy {
    return this.policy;
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  private notifyListeners(event: CircuitBreakerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a circuit breaker manager with the given config
 */
export function createCircuitBreaker(
  config: CircuitBreakerConfig,
): CircuitBreakerManager {
  return new CircuitBreakerManager(config);
}

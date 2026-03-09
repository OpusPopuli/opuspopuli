/**
 * Custom Exception Hierarchy
 *
 * Provides consistent error categorization across the codebase.
 * All custom exceptions extend a common base class with error codes
 * for structured logging and error handling.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/469
 */

/**
 * Base exception for all application errors.
 * Provides a consistent structure with error codes for logging and categorization.
 */
export class AppException extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when required configuration is missing or invalid at startup.
 * These are fatal errors that prevent the application from starting.
 */
export class ConfigurationException extends AppException {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
  }
}

/**
 * Thrown when authentication fails (missing/invalid tokens, missing credentials).
 */
export class AuthenticationException extends AppException {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Thrown when a WebSocket connection is rejected (origin validation, missing params).
 */
export class WebSocketConnectionException extends AppException {
  constructor(message: string) {
    super(message, 'WEBSOCKET_CONNECTION_ERROR');
  }
}

/**
 * Thrown when a service fails to initialize properly.
 */
export class ServiceInitializationException extends AppException {
  constructor(message: string) {
    super(message, 'SERVICE_INITIALIZATION_ERROR');
  }
}

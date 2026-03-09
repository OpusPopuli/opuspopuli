import {
  AppException,
  ConfigurationException,
  AuthenticationException,
  WebSocketConnectionException,
  ServiceInitializationException,
} from './app.exceptions';

describe('Custom Exception Hierarchy', () => {
  describe('AppException', () => {
    it('should extend Error', () => {
      const error = new AppException('test message', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppException);
    });

    it('should set message and code', () => {
      const error = new AppException('test message', 'TEST_CODE');
      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
    });

    it('should set name to class name', () => {
      const error = new AppException('test', 'TEST');
      expect(error.name).toBe('AppException');
    });
  });

  describe('ConfigurationException', () => {
    it('should extend AppException with CONFIGURATION_ERROR code', () => {
      const error = new ConfigurationException('missing config');
      expect(error).toBeInstanceOf(AppException);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.message).toBe('missing config');
      expect(error.name).toBe('ConfigurationException');
    });
  });

  describe('AuthenticationException', () => {
    it('should extend AppException with AUTHENTICATION_ERROR code', () => {
      const error = new AuthenticationException('invalid token');
      expect(error).toBeInstanceOf(AppException);
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.message).toBe('invalid token');
      expect(error.name).toBe('AuthenticationException');
    });
  });

  describe('WebSocketConnectionException', () => {
    it('should extend AppException with WEBSOCKET_CONNECTION_ERROR code', () => {
      const error = new WebSocketConnectionException('origin rejected');
      expect(error).toBeInstanceOf(AppException);
      expect(error.code).toBe('WEBSOCKET_CONNECTION_ERROR');
      expect(error.message).toBe('origin rejected');
      expect(error.name).toBe('WebSocketConnectionException');
    });
  });

  describe('ServiceInitializationException', () => {
    it('should extend AppException with SERVICE_INITIALIZATION_ERROR code', () => {
      const error = new ServiceInitializationException('plugin not available');
      expect(error).toBeInstanceOf(AppException);
      expect(error.code).toBe('SERVICE_INITIALIZATION_ERROR');
      expect(error.message).toBe('plugin not available');
      expect(error.name).toBe('ServiceInitializationException');
    });
  });
});

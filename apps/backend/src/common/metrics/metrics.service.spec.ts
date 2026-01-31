import { Counter, Histogram, Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let mockHttpRequestDuration: jest.Mocked<Histogram<string>>;
  let mockHttpRequestsTotal: jest.Mocked<Counter<string>>;
  let mockGraphqlOperationsTotal: jest.Mocked<Counter<string>>;
  let mockGraphqlOperationDuration: jest.Mocked<Histogram<string>>;
  let mockCircuitBreakerState: jest.Mocked<Gauge<string>>;
  let mockCircuitBreakerFailures: jest.Mocked<Counter<string>>;
  let mockDbQueryDuration: jest.Mocked<Histogram<string>>;
  let mockSubgraphRequestDuration: jest.Mocked<Histogram<string>>;

  beforeEach(() => {
    // Create mock metrics
    mockHttpRequestDuration = {
      observe: jest.fn(),
    } as unknown as jest.Mocked<Histogram<string>>;

    mockHttpRequestsTotal = {
      inc: jest.fn(),
    } as unknown as jest.Mocked<Counter<string>>;

    mockGraphqlOperationsTotal = {
      inc: jest.fn(),
    } as unknown as jest.Mocked<Counter<string>>;

    mockGraphqlOperationDuration = {
      observe: jest.fn(),
    } as unknown as jest.Mocked<Histogram<string>>;

    mockCircuitBreakerState = {
      set: jest.fn(),
    } as unknown as jest.Mocked<Gauge<string>>;

    mockCircuitBreakerFailures = {
      inc: jest.fn(),
    } as unknown as jest.Mocked<Counter<string>>;

    mockDbQueryDuration = {
      observe: jest.fn(),
    } as unknown as jest.Mocked<Histogram<string>>;

    mockSubgraphRequestDuration = {
      observe: jest.fn(),
    } as unknown as jest.Mocked<Histogram<string>>;

    // Instantiate service directly with mocks (bypasses NestJS DI token issues)
    service = new MetricsService(
      mockHttpRequestDuration,
      mockHttpRequestsTotal,
      mockGraphqlOperationsTotal,
      mockGraphqlOperationDuration,
      mockCircuitBreakerState,
      mockCircuitBreakerFailures,
      mockDbQueryDuration,
      mockSubgraphRequestDuration,
    );
  });

  describe('recordHttpRequest', () => {
    it('should record HTTP request duration and count', () => {
      service.recordHttpRequest('GET', '/users', 200, 0.123, 'users-service');

      expect(mockHttpRequestDuration.observe).toHaveBeenCalledWith(
        {
          method: 'GET',
          route: '/users',
          status_code: '200',
          service: 'users-service',
        },
        0.123,
      );
      expect(mockHttpRequestsTotal.inc).toHaveBeenCalledWith({
        method: 'GET',
        route: '/users',
        status_code: '200',
        service: 'users-service',
      });
    });

    it('should normalize routes with UUIDs', () => {
      service.recordHttpRequest(
        'GET',
        '/users/123e4567-e89b-12d3-a456-426614174000',
        200,
        0.1,
        'test',
      );

      expect(mockHttpRequestDuration.observe).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/users/:id' }),
        0.1,
      );
    });

    it('should normalize routes with numeric IDs', () => {
      service.recordHttpRequest('GET', '/users/123', 200, 0.1, 'test');

      expect(mockHttpRequestDuration.observe).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/users/:id' }),
        0.1,
      );
    });

    it('should strip query parameters', () => {
      service.recordHttpRequest(
        'GET',
        '/users?page=1&limit=10',
        200,
        0.1,
        'test',
      );

      expect(mockHttpRequestDuration.observe).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/users' }),
        0.1,
      );
    });
  });

  describe('recordGraphQLOperation', () => {
    it('should record GraphQL query metrics', () => {
      service.recordGraphQLOperation(
        'GetUser',
        'query',
        0.05,
        'api-gateway',
        'success',
      );

      expect(mockGraphqlOperationsTotal.inc).toHaveBeenCalledWith({
        operation_name: 'GetUser',
        operation_type: 'query',
        service: 'api-gateway',
        status: 'success',
      });
      expect(mockGraphqlOperationDuration.observe).toHaveBeenCalledWith(
        {
          operation_name: 'GetUser',
          operation_type: 'query',
          service: 'api-gateway',
        },
        0.05,
      );
    });

    it('should record GraphQL mutation metrics', () => {
      service.recordGraphQLOperation(
        'CreateUser',
        'mutation',
        0.1,
        'api-gateway',
        'success',
      );

      expect(mockGraphqlOperationsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_name: 'CreateUser',
          operation_type: 'mutation',
        }),
      );
    });

    it('should record error status', () => {
      service.recordGraphQLOperation(
        'FailingQuery',
        'query',
        0.01,
        'api-gateway',
        'error',
      );

      expect(mockGraphqlOperationsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' }),
      );
    });

    it('should use "anonymous" for undefined operation name', () => {
      service.recordGraphQLOperation(
        '',
        'query',
        0.05,
        'api-gateway',
        'success',
      );

      expect(mockGraphqlOperationsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ operation_name: 'anonymous' }),
      );
    });
  });

  describe('setCircuitBreakerState', () => {
    it('should set closed state to 0', () => {
      service.setCircuitBreakerState('users-service', 'database', 'closed');

      expect(mockCircuitBreakerState.set).toHaveBeenCalledWith(
        { service: 'users-service', circuit_name: 'database' },
        0,
      );
    });

    it('should set open state to 1', () => {
      service.setCircuitBreakerState('users-service', 'database', 'open');

      expect(mockCircuitBreakerState.set).toHaveBeenCalledWith(
        { service: 'users-service', circuit_name: 'database' },
        1,
      );
    });

    it('should set half_open state to 0.5', () => {
      service.setCircuitBreakerState('users-service', 'database', 'half_open');

      expect(mockCircuitBreakerState.set).toHaveBeenCalledWith(
        { service: 'users-service', circuit_name: 'database' },
        0.5,
      );
    });
  });

  describe('recordCircuitBreakerFailure', () => {
    it('should increment failure counter', () => {
      service.recordCircuitBreakerFailure('users-service', 'database');

      expect(mockCircuitBreakerFailures.inc).toHaveBeenCalledWith({
        service: 'users-service',
        circuit_name: 'database',
      });
    });
  });

  describe('recordDbQuery', () => {
    it('should record database query duration', () => {
      service.recordDbQuery('users-service', 'select', 'users', 0.005);

      expect(mockDbQueryDuration.observe).toHaveBeenCalledWith(
        { service: 'users-service', operation: 'select', table: 'users' },
        0.005,
      );
    });
  });

  describe('recordSubgraphRequest', () => {
    it('should record subgraph request duration', () => {
      service.recordSubgraphRequest('users', 0.025);

      expect(mockSubgraphRequestDuration.observe).toHaveBeenCalledWith(
        { subgraph: 'users' },
        0.025,
      );
    });
  });
});

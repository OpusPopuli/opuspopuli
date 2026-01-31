import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let mockMetricsService: jest.Mocked<MetricsService>;

  beforeEach(() => {
    mockMetricsService = {
      recordHttpRequest: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;

    interceptor = new MetricsInterceptor(mockMetricsService, {
      serviceName: 'test-service',
    });
  });

  const createMockContext = (
    type: 'http' | 'ws' | 'rpc' = 'http',
    request: Record<string, unknown> = {},
    response: Record<string, unknown> = {},
  ): ExecutionContext => {
    return {
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path: '/test',
          ...request,
        }),
        getResponse: () => ({
          statusCode: 200,
          ...response,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = (
    result: unknown = {},
    shouldThrow = false,
  ): CallHandler => {
    return {
      handle: () => (shouldThrow ? throwError(() => result) : of(result)),
    };
  };

  describe('intercept', () => {
    it('should record metrics for successful HTTP request', (done) => {
      const context = createMockContext('http', { path: '/users' });
      const handler = createMockCallHandler({ data: 'test' });

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/users',
            200,
            expect.any(Number),
            'test-service',
          );
          done();
        },
      });
    });

    it('should record metrics for error response', (done) => {
      const context = createMockContext('http', { path: '/users' });
      const error = { status: 404, message: 'Not found' };
      const handler = createMockCallHandler(error, true);

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/users',
            404,
            expect.any(Number),
            'test-service',
          );
          done();
        },
      });
    });

    it('should use 500 for errors without status code', (done) => {
      const context = createMockContext('http', { path: '/users' });
      const error = new Error('Internal error');
      const handler = createMockCallHandler(error, true);

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/users',
            500,
            expect.any(Number),
            'test-service',
          );
          done();
        },
      });
    });

    it('should skip non-HTTP contexts', (done) => {
      const context = createMockContext('ws');
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip /metrics endpoint', (done) => {
      const context = createMockContext('http', { path: '/metrics' });
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip /health endpoints', (done) => {
      const context = createMockContext('http', { path: '/health/live' });
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should use route pattern when available', (done) => {
      const context = createMockContext('http', {
        path: '/users/123',
        route: { path: '/users/:id' },
      });
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/users/:id',
            200,
            expect.any(Number),
            'test-service',
          );
          done();
        },
      });
    });

    it('should fall back to url when path is not available', (done) => {
      const context = createMockContext('http', {
        path: undefined,
        url: '/api/test',
      });
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/api/test',
            200,
            expect.any(Number),
            'test-service',
          );
          done();
        },
      });
    });

    it('should record positive duration', (done) => {
      const context = createMockContext('http', { path: '/test' });
      const handler = createMockCallHandler();

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          const durationArg =
            mockMetricsService.recordHttpRequest.mock.calls[0][3];
          expect(durationArg).toBeGreaterThan(0);
          expect(durationArg).toBeLessThan(1); // Should complete in under 1 second
          done();
        },
      });
    });
  });
});

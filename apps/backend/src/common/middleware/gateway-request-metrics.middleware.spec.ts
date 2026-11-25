import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from '../metrics/metrics.service';
import { GatewayRequestMetricsMiddleware } from './gateway-request-metrics.middleware';

function response(statusCode: number) {
  return Object.assign(new EventEmitter(), {
    statusCode,
  }) as unknown as Response;
}

describe('GatewayRequestMetricsMiddleware (#1456)', () => {
  const recordHttpRequest = jest.fn();
  const middleware = new GatewayRequestMetricsMiddleware(
    { recordHttpRequest } as unknown as MetricsService,
    { serviceName: 'api-gateway' },
  );

  beforeEach(() => recordHttpRequest.mockClear());

  it('passes the request on at once, and records it when the response finishes', () => {
    const res = response(200);
    const next = jest.fn() as NextFunction;
    middleware.use(
      { method: 'POST', originalUrl: '/api' } as Request,
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(recordHttpRequest).not.toHaveBeenCalled();

    res.emit('finish');
    expect(recordHttpRequest).toHaveBeenCalledWith(
      'POST',
      '/api',
      200,
      expect.any(Number),
      'api-gateway',
    );
  });

  it('counts a request the limiter refused, so its rate can be alerted on', () => {
    const res = response(429);
    middleware.use(
      { method: 'GET', originalUrl: '/api' } as Request,
      res,
      jest.fn(),
    );
    res.emit('finish');
    expect(recordHttpRequest.mock.calls[0][2]).toBe(429);
  });

  it('uses one fixed route label, adding no cardinality', () => {
    const res = response(200);
    middleware.use(
      { method: 'GET', originalUrl: '/api?query=%7Bx%7D' } as Request,
      res,
      jest.fn(),
    );
    res.emit('finish');
    expect(recordHttpRequest.mock.calls[0][1]).toBe('/api');
  });

  it('records each request once, however often finish fires', () => {
    const res = response(200);
    middleware.use(
      { method: 'GET', originalUrl: '/api' } as Request,
      res,
      jest.fn(),
    );
    res.emit('finish');
    res.emit('finish');
    expect(recordHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves REST routes under /api/ to the interceptor, which records them already', () => {
    const res = response(401);
    middleware.use(
      { method: 'POST', originalUrl: '/api/auth/refresh' } as Request,
      res,
      jest.fn(),
    );
    res.emit('finish');
    expect(recordHttpRequest).not.toHaveBeenCalled();
  });

  it('still counts a 429 on a REST route: refused there, the interceptor never ran', () => {
    const res = response(429);
    middleware.use(
      { method: 'POST', originalUrl: '/api/auth/refresh' } as Request,
      res,
      jest.fn(),
    );
    res.emit('finish');
    expect(recordHttpRequest.mock.calls[0][2]).toBe(429);
  });
});

import { ArgumentsHost, ForbiddenException } from '@nestjs/common';
import * as sanitizer from './error-sanitizer';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * What the filter writes to the log (#1460). This logger is Nest's own, with
 * no PII redaction, so the filter must not hand it the visitor's data: a
 * query string can carry an address or coordinates, and a user agent is
 * personal information.
 */
describe('AllExceptionsFilter logging (#1460)', () => {
  const VISITOR_URL = '/api?lat=38.5767&lng=-121.4934';
  const filter = new AllExceptionsFilter();
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(sanitizer, 'logErrorDetails')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const loggedMetadata = () =>
    logSpy.mock.calls[0][2] as Record<string, unknown>;

  it('logs an HTTP error with query values redacted and no user agent', () => {
    const json = jest.fn();
    const request = {
      url: VISITOR_URL,
      method: 'POST',
      ip: '172.18.0.5',
      get: () => 'Mozilla/5.0 (visitor)',
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status: () => ({ json }) }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new ForbiddenException('CSRF token required'), host);

    expect(loggedMetadata()).toEqual({
      path: '/api?lat=REDACTED&lng=REDACTED',
      method: 'POST',
      statusCode: 403,
      ip: '172.18.0.5',
    });
    // The response still tells the caller which URL failed: their own.
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ path: VISITOR_URL }),
    );
  });

  it('logs a GraphQL error the same way, then rethrows it', () => {
    const request = {
      url: VISITOR_URL,
      method: 'POST',
      ip: '172.18.0.5',
      headers: { 'user-agent': 'Mozilla/5.0 (visitor)' },
    };
    const args = [{}, {}, { req: request }, { fieldName: 'locate' }];
    const host = {
      getType: () => 'graphql',
      getArgs: () => args,
      getArgByIndex: (index: number) => args[index],
    } as unknown as ArgumentsHost;
    const error = new ForbiddenException();

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(loggedMetadata()).toEqual({
      path: '/api?lat=REDACTED&lng=REDACTED',
      method: 'POST',
      statusCode: 403,
      ip: '172.18.0.5',
    });
  });

  it('falls back to the field name when a GraphQL request has no URL', () => {
    const args = [{}, {}, { req: undefined }, { fieldName: 'locate' }];
    const host = {
      getType: () => 'graphql',
      getArgs: () => args,
      getArgByIndex: (index: number) => args[index],
    } as unknown as ArgumentsHost;

    expect(() => filter.catch(new ForbiddenException(), host)).toThrow();
    expect(loggedMetadata().path).toBe('locate');
  });
});

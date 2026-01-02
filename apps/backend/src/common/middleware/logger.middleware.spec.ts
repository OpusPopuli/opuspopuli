import { Test, TestingModule } from '@nestjs/testing';
import { LoggerMiddleware } from './logger.middleware';
import { Request, Response, NextFunction } from 'express';
import { ILogger, LOGGER } from '@qckstrt/logging-provider';

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let mockLogger: Partial<ILogger>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let finishCallback: () => void;

  beforeEach(async () => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      info: jest.fn(),
      setRequestId: jest.fn(),
      setUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerMiddleware,
        {
          provide: LOGGER,
          useValue: mockLogger,
        },
      ],
    }).compile();

    middleware = module.get<LoggerMiddleware>(LoggerMiddleware);

    mockRequest = {
      headers: {},
      method: 'GET',
      url: '/api/test',
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as Request['socket'],
    };

    mockResponse = {
      statusCode: 200,
      on: jest
        .fn()
        .mockImplementation((event: string, callback: () => void) => {
          if (event === 'finish') {
            finishCallback = callback;
          }
        }),
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('request/response logging', () => {
    it('should log incoming request with method and url', () => {
      mockRequest.method = 'POST';
      mockRequest.url = '/api/users';

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Incoming request',
        undefined,
        expect.objectContaining({
          method: 'POST',
          url: '/api/users',
        }),
      );
    });

    it('should log request completion on response finish', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Simulate response finish
      finishCallback();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request completed',
        undefined,
        expect.objectContaining({
          method: 'GET',
          url: '/api/test',
          statusCode: 200,
          durationMs: expect.any(Number),
        }),
      );
    });

    it('should include duration in completed request log', () => {
      jest.useFakeTimers();

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Advance time by 100ms
      jest.advanceTimersByTime(100);

      finishCallback();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request completed',
        undefined,
        expect.objectContaining({
          durationMs: expect.any(Number),
        }),
      );

      jest.useRealTimers();
    });
  });

  describe('audit context propagation', () => {
    it('should attach audit context to request', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext).toBeDefined();
      expect(mockRequest.auditContext?.requestId).toBeDefined();
      expect(mockRequest.auditContext?.startTime).toBeDefined();
    });

    it('should use x-request-id header if provided', () => {
      mockRequest.headers = {
        'x-request-id': 'custom-request-id-123',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.requestId).toBe('custom-request-id-123');
      expect(mockLogger.setRequestId).toHaveBeenCalledWith(
        'custom-request-id-123',
      );
    });

    it('should generate request id if not provided', () => {
      mockRequest.headers = {};

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.requestId).toBeDefined();
      expect(mockRequest.auditContext?.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should set user id in logger if user header present', () => {
      mockRequest.headers = {
        user: 'user-123',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockLogger.setUserId).toHaveBeenCalledWith('user-123');
    });

    it('should not set user id if user header not present', () => {
      mockRequest.headers = {};

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockLogger.setUserId).not.toHaveBeenCalled();
    });

    it('should include user agent in audit context', () => {
      mockRequest.headers = {
        'user-agent': 'Mozilla/5.0 Test Browser',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.userAgent).toBe(
        'Mozilla/5.0 Test Browser',
      );
    });
  });

  describe('IP address extraction', () => {
    it('should extract IP from x-forwarded-for header (single IP)', () => {
      mockRequest.headers = {
        'x-forwarded-for': '203.0.113.195',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('203.0.113.195');
    });

    it('should extract first IP from x-forwarded-for header (multiple IPs)', () => {
      mockRequest.headers = {
        'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('203.0.113.195');
    });

    it('should extract IP from x-forwarded-for array', () => {
      mockRequest.headers = {
        'x-forwarded-for': ['203.0.113.195', '70.41.3.18'],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('203.0.113.195');
    });

    it('should extract IP from x-real-ip header', () => {
      mockRequest.headers = {
        'x-real-ip': '192.168.1.100',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('192.168.1.100');
    });

    it('should extract IP from x-real-ip array', () => {
      mockRequest.headers = {
        'x-real-ip': ['192.168.1.100'],
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('192.168.1.100');
    });

    it('should fallback to req.ip', () => {
      mockRequest.headers = {};
      Object.defineProperty(mockRequest, 'ip', { value: '10.0.0.1' });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('10.0.0.1');
    });

    it('should fallback to socket remoteAddress', () => {
      mockRequest.headers = {};
      Object.defineProperty(mockRequest, 'ip', { value: undefined });
      mockRequest.socket = { remoteAddress: '10.0.0.2' } as Request['socket'];

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('10.0.0.2');
    });

    it('should prioritize x-forwarded-for over other headers', () => {
      mockRequest.headers = {
        'x-forwarded-for': '203.0.113.195',
        'x-real-ip': '192.168.1.100',
      };
      Object.defineProperty(mockRequest, 'ip', { value: '10.0.0.1' });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.auditContext?.ipAddress).toBe('203.0.113.195');
    });
  });

  describe('middleware flow', () => {
    it('should call next function', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should register finish event listener on response', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.on).toHaveBeenCalledWith(
        'finish',
        expect.any(Function),
      );
    });
  });

  describe('default logger creation', () => {
    it('should create default logger when none injected', async () => {
      const moduleWithoutLogger: TestingModule = await Test.createTestingModule(
        {
          providers: [LoggerMiddleware],
        },
      ).compile();

      const middlewareWithDefault =
        moduleWithoutLogger.get<LoggerMiddleware>(LoggerMiddleware);

      // Should not throw and should work normally
      middlewareWithDefault.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });
});

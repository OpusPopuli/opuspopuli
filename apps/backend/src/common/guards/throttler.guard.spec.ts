import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GqlThrottlerGuard } from './throttler.guard';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerModuleOptions,
  ThrottlerStorage,
  ThrottlerException,
} from '@nestjs/throttler';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('GqlThrottlerGuard', () => {
  let guard: GqlThrottlerGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockStorage: jest.Mocked<ThrottlerStorage>;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    mockStorage = {
      increment: jest.fn(),
    } as unknown as jest.Mocked<ThrottlerStorage>;

    const options: ThrottlerModuleOptions = [
      { name: 'default', ttl: 60000, limit: 10 },
    ];

    guard = new GqlThrottlerGuard(options, mockStorage, mockReflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRequestResponse', () => {
    it('should extract request and response from GraphQL context', () => {
      const mockReq = { ip: '127.0.0.1', headers: {} };
      const mockRes = { setHeader: jest.fn() };

      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: mockReq,
          res: mockRes,
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {
        getType: jest.fn().mockReturnValue('graphql'),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;

      // Access the protected method via type assertion
      const guardWithAccess = guard as unknown as {
        getRequestResponse: (ctx: ExecutionContext) => {
          req: unknown;
          res: unknown;
        };
      };
      const result = guardWithAccess.getRequestResponse(mockExecutionContext);

      expect(GqlExecutionContext.create).toHaveBeenCalledWith(
        mockExecutionContext,
      );
      expect(mockGqlContext.getContext).toHaveBeenCalled();
      expect(result).toEqual({ req: mockReq, res: mockRes });
    });

    it('should create mock response when context has undefined response', () => {
      const mockReq = { ip: '127.0.0.1', headers: {} };

      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: mockReq,
          res: undefined,
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {} as ExecutionContext;

      const guardWithAccess = guard as unknown as {
        getRequestResponse: (ctx: ExecutionContext) => {
          req: unknown;
          res: unknown;
        };
      };
      const result = guardWithAccess.getRequestResponse(mockExecutionContext);

      // The guard creates a mock response for federated subgraphs
      expect(result.req).toEqual(mockReq);
      expect(result.res).toBeDefined();
      expect(typeof (result.res as { header: unknown }).header).toBe(
        'function',
      );
      expect(typeof (result.res as { setHeader: unknown }).setHeader).toBe(
        'function',
      );
    });
  });

  describe('throwThrottlingException', () => {
    it('should log rate limit violation and throw ThrottlerException', async () => {
      const mockReq = { ip: '192.168.1.100', headers: {} };
      const mockRes = { setHeader: jest.fn() };

      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: mockReq,
          res: mockRes,
        }),
        getInfo: jest.fn().mockReturnValue({
          fieldName: 'loginUser',
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {} as ExecutionContext;
      const mockThrottlerLimitDetail = {
        limit: 5,
        ttl: 60000,
        totalHits: 6,
        timeToExpire: 45000,
        isBlocked: true,
        timeToBlockExpire: 45000,
      };

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      // Access the protected method via type assertion
      const guardWithAccess = guard as unknown as {
        throwThrottlingException: (
          ctx: ExecutionContext,
          detail: typeof mockThrottlerLimitDetail,
        ) => Promise<void>;
      };

      await expect(
        guardWithAccess.throwThrottlingException(
          mockExecutionContext,
          mockThrottlerLimitDetail,
        ),
      ).rejects.toThrow(ThrottlerException);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('loginUser'),
      );
      // Masked (#1456): the real client IP, and this logger does not redact.
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('192.x.x.x'),
      );
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('192.168.1.100'),
      );
    });

    it('should log the forwarded client, masked, when ip is not available', async () => {
      const mockReq = {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      };
      const mockRes = { setHeader: jest.fn() };

      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: mockReq,
          res: mockRes,
        }),
        getInfo: jest.fn().mockReturnValue({
          fieldName: 'registerUser',
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {} as ExecutionContext;
      const mockThrottlerLimitDetail = {
        limit: 3,
        ttl: 60000,
        totalHits: 4,
        timeToExpire: 30000,
        isBlocked: true,
        timeToBlockExpire: 30000,
      };

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      const guardWithAccess = guard as unknown as {
        throwThrottlingException: (
          ctx: ExecutionContext,
          detail: typeof mockThrottlerLimitDetail,
        ) => Promise<void>;
      };

      await expect(
        guardWithAccess.throwThrottlingException(
          mockExecutionContext,
          mockThrottlerLimitDetail,
        ),
      ).rejects.toThrow(ThrottlerException);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('10.x.x.x'),
      );
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('10.0.0.1'),
      );
    });

    it('should use unknown when no IP information is available', async () => {
      const mockReq = { headers: {} };
      const mockRes = { setHeader: jest.fn() };

      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: mockReq,
          res: mockRes,
        }),
        getInfo: jest.fn().mockReturnValue({
          fieldName: 'forgotPassword',
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {} as ExecutionContext;
      const mockThrottlerLimitDetail = {
        limit: 3,
        ttl: 3600000,
        totalHits: 4,
        timeToExpire: 3500000,
        isBlocked: true,
        timeToBlockExpire: 3500000,
      };

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      const guardWithAccess = guard as unknown as {
        throwThrottlingException: (
          ctx: ExecutionContext,
          detail: typeof mockThrottlerLimitDetail,
        ) => Promise<void>;
      };

      await expect(
        guardWithAccess.throwThrottlingException(
          mockExecutionContext,
          mockThrottlerLimitDetail,
        ),
      ).rejects.toThrow(ThrottlerException);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown'),
      );
    });

    it('should include limit details in log message', async () => {
      const mockGqlContext = {
        getContext: jest.fn().mockReturnValue({
          req: { ip: '127.0.0.1', headers: {} },
          res: { setHeader: jest.fn() },
        }),
        getInfo: jest.fn().mockReturnValue({
          fieldName: 'sendMagicLink',
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockExecutionContext = {} as ExecutionContext;
      const mockThrottlerLimitDetail = {
        limit: 3,
        ttl: 60000,
        totalHits: 10,
        timeToExpire: 55000,
        isBlocked: true,
        timeToBlockExpire: 55000,
      };

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      const guardWithAccess = guard as unknown as {
        throwThrottlingException: (
          ctx: ExecutionContext,
          detail: typeof mockThrottlerLimitDetail,
        ) => Promise<void>;
      };

      await expect(
        guardWithAccess.throwThrottlingException(
          mockExecutionContext,
          mockThrottlerLimitDetail,
        ),
      ).rejects.toThrow(ThrottlerException);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Limit: 3/60000ms'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Total hits: 10'),
      );
    });
  });
});

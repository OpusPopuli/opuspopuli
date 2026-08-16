import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthMiddleware } from './auth.middleware';
import { Request, Response, NextFunction } from 'express';
import passport from 'passport';

jest.mock('passport');

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockConfigService: Partial<ConfigService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Default passport mock - returns a no-op function
    (passport.authenticate as jest.Mock).mockImplementation(() => {
      return jest.fn();
    });

    mockConfigService = {
      get: jest.fn().mockReturnValue(new Map<string, string>()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthMiddleware,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    middleware = module.get<AuthMiddleware>(AuthMiddleware);

    loggerSpy = jest.spyOn(
      (middleware as unknown as { logger: { log: () => void } }).logger,
      'log',
    );

    mockRequest = {
      headers: {},
    };
    mockResponse = {
      send: jest.fn(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sensitive header masking', () => {
    it('should mask authorization header in logs', () => {
      mockRequest.headers = {
        authorization: 'Bearer secret-jwt-token',
        'content-type': 'application/json',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[REDACTED]'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.not.stringContaining('secret-jwt-token'),
      );
    });

    it('should mask cookie header in logs', () => {
      mockRequest.headers = {
        cookie: 'session=abc123; token=xyz789',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[REDACTED]'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.not.stringContaining('abc123'),
      );
    });

    it('should mask x-api-key header in logs', () => {
      mockRequest.headers = {
        'x-api-key': 'my-secret-api-key',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[REDACTED]'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.not.stringContaining('my-secret-api-key'),
      );
    });

    it('should not mask non-sensitive headers', () => {
      mockRequest.headers = {
        'content-type': 'application/json',
        accept: 'application/json',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('application/json'),
      );
    });
  });

  describe('request validation', () => {
    it('should call next without authentication when no authorization header', () => {
      mockRequest.headers = {};

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(passport.authenticate).not.toHaveBeenCalled();
    });

    it('should authenticate with passport when authorization header present', () => {
      mockRequest.headers = {
        authorization: 'Bearer token',
      };

      const mockAuthenticate = jest.fn().mockImplementation(() => {
        return jest.fn();
      });
      (passport.authenticate as jest.Mock).mockImplementation(mockAuthenticate);

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(passport.authenticate).toHaveBeenCalledWith(
        'jwt',
        { session: false },
        expect.any(Function),
      );
    });

    it('should set user on request when authentication succeeds', () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (passport.authenticate as jest.Mock).mockImplementation(
        (
          _strategy: string,
          _options: object,
          callback: (err: Error | null, user: Express.User | false) => void,
        ) => {
          return () => {
            callback(null, mockUser);
          };
        },
      );

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockRequest.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return error response when token is invalid', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-token',
      };

      (passport.authenticate as jest.Mock).mockImplementation(
        (
          _strategy: string,
          _options: object,
          callback: (err: Error | null, user: Express.User | false) => void,
        ) => {
          return () => {
            callback(null, false);
          };
        },
      );

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.send).toHaveBeenCalledWith({
        success: false,
        message: 'Authorization Token is Invalid!',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error when passport returns error', () => {
      const error = new Error('Passport error');
      mockRequest.headers = {
        authorization: 'Bearer token',
      };

      (passport.authenticate as jest.Mock).mockImplementation(
        (
          _strategy: string,
          _options: object,
          callback: (err: Error | null, user: Express.User | false) => void,
        ) => {
          return () => {
            callback(error, false);
          };
        },
      );

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
  describe('session-lifecycle routes with an invalid token', () => {
    /*
     * The regression these pin. AuthMiddleware answers the request itself when
     * a presented access token fails to validate, so the route never runs —
     * which meant the endpoint whose entire job is to clear your cookies could
     * not clear them exactly when they most needed clearing. A user clicked
     * "log out", the request died here, the cookies survived, and they stayed
     * signed in as the previous account while registering a new one.
     *
     * Both the #977 plan and the refresh controller's comment asserted this
     * middleware "never rejects". It does, and the logout route was built on
     * that false premise.
     */
    const rejectOnAuthFailure = () => {
      (passport.authenticate as jest.Mock).mockImplementation(
        (_strategy, _opts, callback) => () => callback(null, false),
      );
    };

    const runWith = (path: string) => {
      rejectOnAuthFailure();
      const req = {
        headers: {},
        cookies: { 'access-token': 'expired-or-malformed' },
        path,
        url: path,
      } as unknown as Request;
      middleware.use(req, mockResponse as Response, mockNext);
      return req;
    };

    it.each(['/api/auth/logout', '/api/auth/refresh'])(
      'lets %s through so it can clear cookies',
      (path) => {
        runWith(path);

        expect(mockNext).toHaveBeenCalled();
        expect(mockResponse.send).not.toHaveBeenCalled();
      },
    );

    it('leaves req.user unset on the routes it lets through', () => {
      const req = runWith('/api/auth/logout');

      // Passing through is not authenticating. Anything downstream needing a
      // caller must still find none.
      expect(req.user).toBeUndefined();
    });

    it('still rejects other routes carrying an invalid token', () => {
      runWith('/api/some/protected/thing');

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });

    it('does not exempt a path that merely starts with a lifecycle path', () => {
      // Guards against a startsWith implementation letting
      // /api/auth/logout-all-the-things through.
      runWith('/api/auth/logout-something-else');

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('ignores the query string when matching', () => {
      rejectOnAuthFailure();
      const req = {
        headers: {},
        cookies: { 'access-token': 'expired' },
        // Express sets `path` without the query, but url carries it; the
        // fallback must not be fooled.
        url: '/api/auth/logout?redirect=%2F',
      } as unknown as Request;

      middleware.use(req, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
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

    mockRequest = {
      headers: {},
    };
    mockResponse = {
      send: jest.fn(),
      // Chainable like the real Express response: res.status(...).set(...).send(...)
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('request logging (#1460)', () => {
    // It used to log every request's headers at info level, redacting only
    // credentials. The visitor's IP (cf-connecting-ip, x-forwarded-for), user
    // agent and CSRF token went to production logs and on to Loki unmasked.
    it('logs nothing about the request, headers included', () => {
      const spies = (['log', 'debug', 'verbose', 'warn', 'error'] as const).map(
        (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
      );
      mockRequest.headers = {
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': '198.51.100.7, 172.18.0.5',
        'user-agent': 'Mozilla/5.0 (visitor)',
        'x-csrf-token': 'csrf-value',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
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
      // The status is the contract (#1022): a 200 here made auth failures
      // indistinguishable from success for every status-checking client,
      // which is exactly how the old behavior survived — the tests
      // asserted only the body.
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer error="invalid_token"',
      );
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

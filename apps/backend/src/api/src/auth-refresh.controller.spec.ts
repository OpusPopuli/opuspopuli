import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthRefreshController } from './auth-refresh.controller';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import { REFRESH_COOKIE_PATH } from 'src/common/utils/cookie.utils';

const MICROSERVICES = JSON.stringify([
  { name: 'users', url: 'http://users:3001/graphql' },
  { name: 'documents', url: 'http://documents:3002/graphql' },
]);

const createConfigService = () =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'MICROSERVICES') return MICROSERVICES;
      if (key === 'cookie.refreshTokenName') return 'refresh-token';
      return undefined;
    }),
  }) as unknown as ConfigService;

const createRequest = (cookies: Record<string, string> = {}) =>
  ({ cookies }) as unknown as Request;

const createResponse = () =>
  ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  }) as unknown as Response;

const renewed = {
  accessToken: 'new-access',
  idToken: 'new-id',
  refreshToken: 'rotated-refresh',
};

describe('AuthRefreshController', () => {
  // The failure this guards against is silent. If the served route and the
  // cookie's path ever diverge, the browser simply never sends the refresh
  // cookie: no error, no log — renewal 401s and the user is bounced to
  // /login, which is the bug #977 fixed. Nothing else ties these together,
  // because they are set by decorators in one file and a constant in another.
  it('serves exactly the path the refresh cookie is scoped to', () => {
    const controllerPath = Reflect.getMetadata(
      PATH_METADATA,
      AuthRefreshController,
    );
    const methodPath = Reflect.getMetadata(
      PATH_METADATA,
      AuthRefreshController.prototype.refresh,
    );

    const served = `/${controllerPath}/${methodPath}`.replace(/\/+/g, '/');

    expect(served).toBe(REFRESH_COOKIE_PATH);
  });

  let controller: AuthRefreshController;
  let hmacSigner: { isEnabled: jest.Mock; signGraphQLRequest: jest.Mock };
  const fetchMock = jest.fn();

  beforeEach(async () => {
    hmacSigner = {
      isEnabled: jest.fn().mockReturnValue(true),
      signGraphQLRequest: jest.fn().mockReturnValue('signed-hmac-header'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthRefreshController],
      providers: [
        { provide: ConfigService, useValue: createConfigService() },
        { provide: HmacSignerService, useValue: hmacSigner },
      ],
    }).compile();

    controller = module.get<AuthRefreshController>(AuthRefreshController);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const okResponse = () => ({
    json: jest.fn().mockResolvedValue({ data: { refreshSession: renewed } }),
  });

  const errorResponse = (code?: string) => ({
    json: jest.fn().mockResolvedValue({
      errors: [{ message: 'nope', extensions: code ? { code } : undefined }],
    }),
  });

  describe('success', () => {
    it('should set fresh cookies and return no body', async () => {
      fetchMock.mockResolvedValue(okResponse());
      const res = createResponse();

      const result = await controller.refresh(
        createRequest({ 'refresh-token': 'old-token' }),
        res,
      );

      expect(res.cookie).toHaveBeenCalled();
      // 204 means the tokens live in cookies and nowhere a script can read.
      expect(result).toBeUndefined();
    });

    it('should call the users subgraph, not another one', async () => {
      fetchMock.mockResolvedValue(okResponse());

      await controller.refresh(
        createRequest({ 'refresh-token': 'old-token' }),
        createResponse(),
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://users:3001/graphql');
      expect(JSON.parse(init.body).variables.refreshToken).toBe('old-token');
    });

    it('should sign the call so the subgraph accepts it', async () => {
      fetchMock.mockResolvedValue(okResponse());

      await controller.refresh(
        createRequest({ 'refresh-token': 'old-token' }),
        createResponse(),
      );

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['X-HMAC-Auth']).toBe('signed-hmac-header');
    });
  });

  describe('terminal failures — sign in again', () => {
    it('should 401 and clear cookies when no refresh cookie is present', async () => {
      const res = createResponse();

      await expect(controller.refresh(createRequest(), res)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(res.clearCookie).toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should 401 and clear cookies when the grant was rejected', async () => {
      fetchMock.mockResolvedValue(errorResponse('REFRESH_TOKEN_INVALID'));
      const res = createResponse();

      await expect(
        controller.refresh(createRequest({ 'refresh-token': 'dead' }), res),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  // The whole point of carrying the error code through from subtask 2. Every
  // case here must keep the cookies: none of them is evidence the session is
  // dead, and clearing them turns a transient failure into a forced sign-out
  // for every active user at once.
  describe('transient failures — keep the session', () => {
    it.each([
      [
        'the subgraph is unreachable',
        () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED')),
      ],
      [
        'the response is not JSON',
        () =>
          fetchMock.mockResolvedValue({
            json: jest.fn().mockRejectedValue(new Error('bad json')),
          }),
      ],
      [
        'the provider was unavailable upstream',
        () => fetchMock.mockResolvedValue(errorResponse('REFRESH_ERROR')),
      ],
      [
        'the error carries no code at all',
        () => fetchMock.mockResolvedValue(errorResponse(undefined)),
      ],
      [
        'the response has neither tokens nor errors',
        () =>
          fetchMock.mockResolvedValue({
            json: jest.fn().mockResolvedValue({ data: {} }),
          }),
      ],
    ])('should 503 and NOT clear cookies when %s', async (_label, arrange) => {
      arrange();
      const res = createResponse();

      await expect(
        controller.refresh(createRequest({ 'refresh-token': 'good' }), res),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(res.clearCookie).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  it('should fail without clearing cookies when no users subgraph is configured', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthRefreshController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'MICROSERVICES' ? '[]' : 'refresh-token',
            ),
          },
        },
        { provide: HmacSignerService, useValue: hmacSigner },
      ],
    }).compile();
    const misconfigured = module.get<AuthRefreshController>(
      AuthRefreshController,
    );
    const res = createResponse();

    await expect(
      misconfigured.refresh(createRequest({ 'refresh-token': 'good' }), res),
    ).rejects.toThrow(ServiceUnavailableException);

    // A deployment mistake must not log every user out.
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});

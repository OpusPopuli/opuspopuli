import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { GraphQLAuditInterceptor } from './graphql-audit.interceptor';
import { AuditLogService } from '../services/audit-log.service';
import { AuditAction } from '../enums/audit-action.enum';

// Mock GqlExecutionContext
jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

import { GqlExecutionContext } from '@nestjs/graphql';

describe('GraphQLAuditInterceptor', () => {
  let interceptor: GraphQLAuditInterceptor;
  let reflector: jest.Mocked<Reflector>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    reflector = {
      get: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    auditLogService = {
      log: jest.fn(),
      logSync: jest.fn(),
    } as unknown as jest.Mocked<AuditLogService>;

    configService = {
      get: jest.fn().mockReturnValue('test-service'),
    } as unknown as jest.Mocked<ConfigService>;

    interceptor = new GraphQLAuditInterceptor(
      reflector,
      auditLogService,
      configService,
    );

    jest.clearAllMocks();
  });

  const createMockGqlContext = (options: {
    fieldName: string;
    operationType: string;
    operationName?: string;
    args?: Record<string, unknown>;
    userHeader?: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    const mockRequest = {
      headers: {
        user: options.userHeader,
        'x-request-id': options.requestId || 'test-request-id',
        'x-forwarded-for': options.ipAddress,
        'user-agent': options.userAgent || 'test-agent',
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };

    const mockGqlContext = {
      getInfo: () => ({
        fieldName: options.fieldName,
        operation: {
          operation: options.operationType,
          name: options.operationName
            ? { value: options.operationName }
            : undefined,
        },
        parentType: {
          name: options.operationType === 'query' ? 'Query' : 'Mutation',
        },
      }),
      getContext: () => ({ req: mockRequest }),
      getArgs: () => options.args || {},
    };

    (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

    // Return a mock ExecutionContext with getHandler and getType methods
    return {
      getHandler: jest.fn().mockReturnValue(() => {}),
      getType: jest.fn().mockReturnValue('graphql'),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = (
    result: unknown = { data: 'test' },
  ): CallHandler => ({
    handle: () => of(result),
  });

  const createErrorCallHandler = (error: Error): CallHandler => ({
    handle: () => throwError(() => error),
  });

  /**
   * #1151. `entityId` came from `args.id` alone, so every mutation using the
   * input-object convention — all of `documents` — logged a null id and the
   * `(entityType, entityId)` index answered nothing for that service.
   */
  describe('entityId resolution for input-object mutations (#1151)', () => {
    const captureEntityId = (
      ctx: ExecutionContext,
      done: (v: string | undefined) => void,
    ) => {
      interceptor.intercept(ctx, createMockCallHandler()).subscribe({
        complete: () => {
          const call = auditLogService.log.mock.calls[0]?.[0] as
            | { entityId?: string }
            | undefined;
          done(call?.entityId);
        },
      });
    };

    it('still reads a top-level args.id', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'updateDocument',
        operationType: 'mutation',
        args: { id: 'doc-top' },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBe('doc-top');
        done();
      });
    });

    it('reads input.id when the mutation takes an input object', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'updateDocument',
        operationType: 'mutation',
        args: { input: { id: 'doc-in-input' } },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBe('doc-in-input');
        done();
      });
    });

    it('reads input.documentId — the documents convention', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'analyzeDocument',
        operationType: 'mutation',
        args: { input: { documentId: 'doc-typed' } },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBe('doc-typed');
        done();
      });
    });

    // Two ids in one input. Resolution is by LIST ORDER — documentId leads
    // because the document is the subject being acted on — so this pins the
    // ordering, not just that some id was found.
    it('prefers documentId when the input carries several ids', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'linkDocumentToProposition',
        operationType: 'mutation',
        args: {
          input: { propositionId: 'prop-999', documentId: 'doc-correct' },
        },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBe('doc-correct');
        done();
      });
    });

    // A create mutation has no id yet. Null is honest; a guessed id is not.
    it('records no id for a mutation that mints the entity', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'processScan',
        operationType: 'mutation',
        args: { input: { data: 'base64…', mimeType: 'image/jpeg' } },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBeUndefined();
        done();
      });
    });

    it('ignores a non-string id rather than coercing it', (done) => {
      const ctx = createMockGqlContext({
        fieldName: 'updateDocument',
        operationType: 'mutation',
        args: { input: { id: { nested: 'object' } } },
      });
      captureEntityId(ctx, (id) => {
        expect(id).toBeUndefined();
        done();
      });
    });
  });

  describe('intercept', () => {
    it('should be defined', () => {
      expect(interceptor).toBeDefined();
    });

    it('should skip non-GraphQL requests (HTTP/REST)', (done) => {
      const mockCallHandler = createMockCallHandler();
      const context = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getType: jest.fn().mockReturnValue('http'),
      } as unknown as ExecutionContext;

      interceptor.intercept(context, mockCallHandler).subscribe({
        complete: () => {
          expect(auditLogService.log).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip when GraphQL info has no fieldName', (done) => {
      const mockCallHandler = createMockCallHandler();
      const mockGqlContext = {
        getInfo: () => ({}), // No fieldName
        getContext: () => ({ req: {} }),
        getArgs: () => ({}),
      };
      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const context = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getType: jest.fn().mockReturnValue('graphql'),
      } as unknown as ExecutionContext;

      interceptor.intercept(context, mockCallHandler).subscribe({
        complete: () => {
          expect(auditLogService.log).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip audit when skipAudit is true', (done) => {
      reflector.get.mockReturnValue({ skipAudit: true });

      const context = createMockGqlContext({
        fieldName: 'testQuery',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should log successful query operations', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'getUser',
        operationType: 'query',
        args: { id: 'user-123' },
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: AuditAction.READ,
              success: true,
              resolverName: 'getUser',
              entityType: 'User',
            }),
          );
          done();
        },
      });
    });

    it('should log mutation operations with correct action', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'createUser',
        operationType: 'mutation',
        args: { input: { email: 'test@example.com' } },
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: AuditAction.CREATE,
              operationType: 'mutation',
            }),
          );
          done();
        },
      });
    });

    it('should log failed operations', (done) => {
      reflector.get.mockReturnValue(undefined);
      const testError = new Error('Test error');

      const context = createMockGqlContext({
        fieldName: 'deleteUser',
        operationType: 'mutation',
        args: { id: 'user-123' },
      });

      interceptor
        .intercept(context, createErrorCallHandler(testError))
        .subscribe({
          error: () => {
            expect(auditLogService.log).toHaveBeenCalledWith(
              expect.objectContaining({
                action: AuditAction.DELETE,
                success: false,
                errorMessage: 'Test error',
              }),
            );
            done();
          },
        });
    });

    it('should use decorator metadata when provided', (done) => {
      reflector.get.mockReturnValue({
        action: AuditAction.LOGIN,
        entityType: 'Auth',
      });

      const context = createMockGqlContext({
        fieldName: 'loginUser',
        operationType: 'mutation',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: AuditAction.LOGIN,
              entityType: 'Auth',
            }),
          );
          done();
        },
      });
    });

    it('should extract user info from headers', (done) => {
      reflector.get.mockReturnValue(undefined);
      const userHeader = JSON.stringify({
        id: 'user-456',
        email: 'user@example.com',
      });

      const context = createMockGqlContext({
        fieldName: 'getProfile',
        operationType: 'query',
        userHeader,
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: 'user-456',
              userEmail: 'user@example.com',
            }),
          );
          done();
        },
      });
    });

    it('should extract IP address from x-forwarded-for header', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'testQuery',
        operationType: 'query',
        ipAddress: '192.168.1.1, 10.0.0.1',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              ipAddress: '192.168.1.1',
            }),
          );
          done();
        },
      });
    });

    it('should extract IP address from x-real-ip header when x-forwarded-for is not present', (done) => {
      reflector.get.mockReturnValue(undefined);

      const mockRequest = {
        headers: {
          'x-request-id': 'test-request-id',
          'x-real-ip': '10.20.30.40',
          'user-agent': 'test-agent',
        },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      };

      const mockGqlContext = {
        getInfo: () => ({
          fieldName: 'testQuery',
          operation: { operation: 'query' },
          parentType: { name: 'Query' },
        }),
        getContext: () => ({ req: mockRequest }),
        getArgs: () => ({}),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const context = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getType: jest.fn().mockReturnValue('graphql'),
      } as unknown as ExecutionContext;

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              ipAddress: '10.20.30.40',
            }),
          );
          done();
        },
      });
    });

    it('should handle invalid JSON in user header gracefully', (done) => {
      reflector.get.mockReturnValue(undefined);

      const mockRequest = {
        headers: {
          user: 'invalid-json-not-parseable',
          'x-request-id': 'test-request-id',
          'user-agent': 'test-agent',
        },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      };

      const mockGqlContext = {
        getInfo: () => ({
          fieldName: 'testQuery',
          operation: { operation: 'query' },
          parentType: { name: 'Query' },
        }),
        getContext: () => ({ req: mockRequest }),
        getArgs: () => ({}),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const context = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getType: jest.fn().mockReturnValue('graphql'),
      } as unknown as ExecutionContext;

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          // Should still log successfully, just without user info
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: undefined,
              userEmail: undefined,
            }),
          );
          done();
        },
      });
    });

    it('should include duration in audit log', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'testQuery',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              durationMs: expect.any(Number),
            }),
          );
          done();
        },
      });
    });
  });

  describe('action inference', () => {
    const testCases = [
      { fieldName: 'createUser', expected: AuditAction.CREATE },
      { fieldName: 'registerUser', expected: AuditAction.CREATE },
      { fieldName: 'updateUser', expected: AuditAction.UPDATE },
      { fieldName: 'changePassword', expected: AuditAction.UPDATE },
      { fieldName: 'deleteUser', expected: AuditAction.DELETE },
      { fieldName: 'removeUser', expected: AuditAction.DELETE },
      { fieldName: 'loginUser', expected: AuditAction.LOGIN },
      { fieldName: 'logoutUser', expected: AuditAction.LOGOUT },
      { fieldName: 'uploadFile', expected: AuditAction.UPLOAD },
      { fieldName: 'indexDocument', expected: AuditAction.UPLOAD },
    ];

    testCases.forEach(({ fieldName, expected }) => {
      it(`should infer ${expected} action from ${fieldName}`, (done) => {
        reflector.get.mockReturnValue(undefined);

        const context = createMockGqlContext({
          fieldName,
          operationType: 'mutation',
        });

        interceptor.intercept(context, createMockCallHandler()).subscribe({
          complete: () => {
            expect(auditLogService.log).toHaveBeenCalledWith(
              expect.objectContaining({
                action: expected,
              }),
            );
            done();
          },
        });
      });
    });

    it('should infer SEARCH action for search queries', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'searchText',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: AuditAction.SEARCH,
            }),
          );
          done();
        },
      });
    });

    it('should infer BULK_READ for list operations', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'listUsers',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              action: AuditAction.BULK_READ,
            }),
          );
          done();
        },
      });
    });
  });

  describe('entity type inference', () => {
    it('should extract entity type from resolver name', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'getDocument',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              entityType: 'Document',
            }),
          );
          done();
        },
      });
    });

    it('should handle plural entity names', (done) => {
      reflector.get.mockReturnValue(undefined);

      const context = createMockGqlContext({
        fieldName: 'getUsers',
        operationType: 'query',
      });

      interceptor.intercept(context, createMockCallHandler()).subscribe({
        complete: () => {
          expect(auditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              entityType: 'User',
            }),
          );
          done();
        },
      });
    });
  });
});

import { ArgumentsHost } from '@nestjs/common';
import { GqlArgumentsHost } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { GraphQLExceptionFilter } from './graphql-exception.filter';

jest.mock('@nestjs/graphql', () => ({
  GqlArgumentsHost: {
    create: jest.fn(),
  },
}));

describe('GraphQLExceptionFilter', () => {
  let filter: GraphQLExceptionFilter;
  let mockArgumentsHost: Partial<ArgumentsHost>;

  beforeEach(() => {
    filter = new GraphQLExceptionFilter();
    mockArgumentsHost = {};
    jest.clearAllMocks();
  });

  const createMockGqlHost = (options: {
    fieldName?: string;
    originalUrl?: string;
    url?: string;
  }) => {
    const mockRequest = {
      originalUrl: options.originalUrl,
      url: options.url,
    };

    const mockGqlHost = {
      getContext: () => ({ req: mockRequest }),
      getInfo: () =>
        options.fieldName ? { fieldName: options.fieldName } : null,
    };

    (GqlArgumentsHost.create as jest.Mock).mockReturnValue(mockGqlHost);

    return mockGqlHost;
  };

  describe('error transformation', () => {
    it('should transform GraphQL error with message', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Test error message');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result).toBeInstanceOf(GraphQLError);
      expect(result.message).toBe('Test error message');
    });

    it('should preserve error code from original error', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Unauthorized', {
        extensions: { code: 'UNAUTHORIZED' },
      });

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.code).toBe('UNAUTHORIZED');
    });

    it('should default to 500 when no code in original error', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Internal error');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.code).toBe(500);
    });
  });

  describe('error format consistency', () => {
    it('should include timestamp in error response', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Test error');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.timestamp).toBeDefined();
      expect(typeof result.extensions?.timestamp).toBe('string');
      // Verify it's a valid ISO date string
      expect(
        () => new Date(result.extensions?.timestamp as string),
      ).not.toThrow();
    });

    it('should include path from field name', () => {
      createMockGqlHost({ fieldName: 'getUserById' });

      const originalError = new GraphQLError('User not found');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.path).toBe('getUserById');
    });

    it('should use originalUrl as path when field name not available', () => {
      createMockGqlHost({ originalUrl: '/graphql' });

      const originalError = new GraphQLError('Error occurred');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.path).toBe('/graphql');
    });

    it('should use url as path when originalUrl not available', () => {
      createMockGqlHost({ url: '/api/graphql' });

      const originalError = new GraphQLError('Error occurred');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.path).toBe('/api/graphql');
    });
  });

  describe('sensitive data not leaked', () => {
    it('should only include safe error information', () => {
      createMockGqlHost({ fieldName: 'testMutation' });

      const originalError = new GraphQLError('Database connection failed', {
        extensions: {
          code: 'INTERNAL_SERVER_ERROR',
          stackTrace: 'Error at line 42...',
          databasePassword: 'secret123',
        },
      });

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      // Should have standard fields
      expect(result.extensions?.code).toBeDefined();
      expect(result.extensions?.timestamp).toBeDefined();
      expect(result.extensions?.path).toBeDefined();

      // Should not leak internal details
      expect(result.extensions?.stackTrace).toBeUndefined();
      expect(result.extensions?.databasePassword).toBeUndefined();
    });

    it('should not expose internal exception details', () => {
      createMockGqlHost({ fieldName: 'sensitiveOperation' });

      const originalError = new GraphQLError('Operation failed', {
        extensions: {
          code: 'BAD_USER_INPUT',
          internalQuery: 'SELECT * FROM users WHERE password = ...',
        },
      });

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.internalQuery).toBeUndefined();
    });
  });

  describe('various error scenarios', () => {
    it('should handle error with null extensions', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Error with null extensions');
      // Force extensions to be treated as undefined
      Object.defineProperty(originalError, 'extensions', { value: undefined });

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.code).toBe(500);
    });

    it('should handle empty error message', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.message).toBe('');
    });

    it('should handle complex error codes', () => {
      createMockGqlHost({ fieldName: 'testQuery' });

      const originalError = new GraphQLError('Validation failed', {
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      });

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
    });

    it('should handle missing request context', () => {
      const mockGqlHost = {
        getContext: () => ({ req: undefined }),
        getInfo: () => ({ fieldName: 'testQuery' }),
      };
      (GqlArgumentsHost.create as jest.Mock).mockReturnValue(mockGqlHost);

      const originalError = new GraphQLError('Error with no request');

      const result = filter.catch(
        originalError,
        mockArgumentsHost as ArgumentsHost,
      );

      expect(result.extensions?.path).toBe('testQuery');
    });
  });
});

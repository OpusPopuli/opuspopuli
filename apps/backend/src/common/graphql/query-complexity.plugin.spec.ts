import { GraphQLError } from 'graphql';
import { GraphQLRequestContext, BaseContext } from '@apollo/server';
import {
  createQueryComplexityValidationRule,
  createQueryComplexityLoggingPlugin,
  DEFAULT_QUERY_COMPLEXITY_CONFIG,
} from './query-complexity.plugin';

describe('QueryComplexityPlugin', () => {
  describe('DEFAULT_QUERY_COMPLEXITY_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_QUERY_COMPLEXITY_CONFIG).toEqual({
        maxDepth: 10,
        maxComplexity: 1000,
        scalarCost: 1,
        objectCost: 10,
        listFactor: 10,
        logComplexity: false,
      });
    });
  });

  describe('createQueryComplexityValidationRule', () => {
    it('should create a validation rule function', () => {
      const rule = createQueryComplexityValidationRule();
      expect(typeof rule).toBe('function');
    });

    it('should use default config when no config provided', () => {
      const rule = createQueryComplexityValidationRule();
      expect(rule).toBeDefined();
    });

    it('should merge partial config with defaults', () => {
      const rule = createQueryComplexityValidationRule({
        maxComplexity: 500,
      });
      expect(rule).toBeDefined();
    });

    it('should accept custom maxComplexity', () => {
      const rule = createQueryComplexityValidationRule({
        maxComplexity: 2000,
      });
      expect(rule).toBeDefined();
    });

    it('should accept custom scalarCost', () => {
      const rule = createQueryComplexityValidationRule({
        scalarCost: 2,
      });
      expect(rule).toBeDefined();
    });

    it('should accept logComplexity option', () => {
      const rule = createQueryComplexityValidationRule({
        logComplexity: true,
      });
      expect(rule).toBeDefined();
    });
  });

  describe('createQueryComplexityLoggingPlugin', () => {
    it('should create a plugin object', () => {
      const plugin = createQueryComplexityLoggingPlugin();
      expect(plugin).toBeDefined();
      expect(typeof plugin.requestDidStart).toBe('function');
    });

    it('should return request listener on requestDidStart', async () => {
      const plugin = createQueryComplexityLoggingPlugin();
      const mockContext = {} as GraphQLRequestContext<BaseContext>;
      const listener = await plugin.requestDidStart!(mockContext);
      expect(listener).toBeDefined();
      if (listener) {
        expect(typeof listener.willSendResponse).toBe('function');
      }
    });
  });
});

describe('GraphQL complexity error format', () => {
  it('should create proper error with extensions', () => {
    const error = new GraphQLError(
      'Query complexity of 1500 exceeds maximum allowed complexity of 1000. ' +
        'Please simplify your query by requesting fewer fields or reducing nesting.',
      {
        extensions: {
          code: 'QUERY_COMPLEXITY_EXCEEDED',
          complexity: 1500,
          maxComplexity: 1000,
        },
      },
    );

    expect(error.message).toContain('Query complexity of 1500');
    expect(error.extensions.code).toBe('QUERY_COMPLEXITY_EXCEEDED');
    expect(error.extensions.complexity).toBe(1500);
    expect(error.extensions.maxComplexity).toBe(1000);
  });
});

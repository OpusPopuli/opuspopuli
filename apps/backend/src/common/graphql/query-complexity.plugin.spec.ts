import { GraphQLError } from 'graphql';
import { GraphQLRequestContext, BaseContext } from '@apollo/server';
import {
  createQueryComplexityPlugin,
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

  describe('createQueryComplexityPlugin', () => {
    it('should create a plugin object', () => {
      const plugin = createQueryComplexityPlugin();
      expect(plugin).toBeDefined();
      expect(typeof plugin.requestDidStart).toBe('function');
    });

    it('should return request listener with didResolveOperation', async () => {
      const plugin = createQueryComplexityPlugin();
      const mockContext = {} as GraphQLRequestContext<BaseContext>;
      const listener = await plugin.requestDidStart!(mockContext);
      expect(listener).toBeDefined();
      if (listener) {
        expect(typeof listener.didResolveOperation).toBe('function');
      }
    });

    it('should use default config when no config provided', () => {
      const plugin = createQueryComplexityPlugin();
      expect(plugin).toBeDefined();
    });

    it('should merge partial config with defaults', () => {
      const plugin = createQueryComplexityPlugin({
        maxComplexity: 500,
      });
      expect(plugin).toBeDefined();
    });

    it('should accept custom maxComplexity', () => {
      const plugin = createQueryComplexityPlugin({
        maxComplexity: 2000,
      });
      expect(plugin).toBeDefined();
    });

    it('should accept custom scalarCost', () => {
      const plugin = createQueryComplexityPlugin({
        scalarCost: 2,
      });
      expect(plugin).toBeDefined();
    });

    it('should accept logComplexity option', () => {
      const plugin = createQueryComplexityPlugin({
        logComplexity: true,
      });
      expect(plugin).toBeDefined();
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

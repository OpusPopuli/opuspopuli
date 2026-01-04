import queryComplexityConfig, {
  IQueryComplexityConfig,
} from './query-complexity.config';

describe('queryComplexityConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('default values', () => {
    it('should return default maxDepth of 10', () => {
      const config = queryComplexityConfig();
      expect(config.maxDepth).toBe(10);
    });

    it('should return default maxComplexity of 1000', () => {
      const config = queryComplexityConfig();
      expect(config.maxComplexity).toBe(1000);
    });

    it('should return default scalarCost of 1', () => {
      const config = queryComplexityConfig();
      expect(config.scalarCost).toBe(1);
    });

    it('should return default objectCost of 10', () => {
      const config = queryComplexityConfig();
      expect(config.objectCost).toBe(10);
    });

    it('should return default listFactor of 10', () => {
      const config = queryComplexityConfig();
      expect(config.listFactor).toBe(10);
    });

    it('should return default logComplexity of false', () => {
      const config = queryComplexityConfig();
      expect(config.logComplexity).toBe(false);
    });
  });

  describe('environment variable overrides', () => {
    it('should use GRAPHQL_MAX_DEPTH from environment', () => {
      process.env.GRAPHQL_MAX_DEPTH = '15';
      const config = queryComplexityConfig();
      expect(config.maxDepth).toBe(15);
    });

    it('should use GRAPHQL_MAX_COMPLEXITY from environment', () => {
      process.env.GRAPHQL_MAX_COMPLEXITY = '2000';
      const config = queryComplexityConfig();
      expect(config.maxComplexity).toBe(2000);
    });

    it('should use GRAPHQL_SCALAR_COST from environment', () => {
      process.env.GRAPHQL_SCALAR_COST = '2';
      const config = queryComplexityConfig();
      expect(config.scalarCost).toBe(2);
    });

    it('should use GRAPHQL_OBJECT_COST from environment', () => {
      process.env.GRAPHQL_OBJECT_COST = '20';
      const config = queryComplexityConfig();
      expect(config.objectCost).toBe(20);
    });

    it('should use GRAPHQL_LIST_FACTOR from environment', () => {
      process.env.GRAPHQL_LIST_FACTOR = '20';
      const config = queryComplexityConfig();
      expect(config.listFactor).toBe(20);
    });

    it('should enable logComplexity when GRAPHQL_LOG_COMPLEXITY is true', () => {
      process.env.GRAPHQL_LOG_COMPLEXITY = 'true';
      const config = queryComplexityConfig();
      expect(config.logComplexity).toBe(true);
    });

    it('should keep logComplexity false when GRAPHQL_LOG_COMPLEXITY is not "true"', () => {
      process.env.GRAPHQL_LOG_COMPLEXITY = 'false';
      const config = queryComplexityConfig();
      expect(config.logComplexity).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should return IQueryComplexityConfig interface', () => {
      const config: IQueryComplexityConfig = queryComplexityConfig();
      expect(config).toHaveProperty('maxDepth');
      expect(config).toHaveProperty('maxComplexity');
      expect(config).toHaveProperty('scalarCost');
      expect(config).toHaveProperty('objectCost');
      expect(config).toHaveProperty('listFactor');
      expect(config).toHaveProperty('logComplexity');
    });
  });
});

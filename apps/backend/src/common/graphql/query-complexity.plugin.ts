import { ApolloServerPlugin, BaseContext } from '@apollo/server';
import { GraphQLError } from 'graphql';
import {
  createComplexityRule,
  simpleEstimator,
  fieldExtensionsEstimator,
} from 'graphql-query-complexity';
import { Logger } from '@nestjs/common';
import { IQueryComplexityConfig } from 'src/config/query-complexity.config';

const logger = new Logger('QueryComplexity');

/**
 * Default query complexity configuration
 *
 * Used when configuration is not available from environment/config service.
 */
export const DEFAULT_QUERY_COMPLEXITY_CONFIG: IQueryComplexityConfig = {
  maxDepth: 10,
  maxComplexity: 1000,
  scalarCost: 1,
  objectCost: 10,
  listFactor: 10,
  logComplexity: false,
};

/**
 * Creates a GraphQL validation rule for query complexity limiting.
 *
 * SECURITY: Prevents DoS attacks by limiting the complexity of GraphQL queries.
 * Complex queries with many fields or deeply nested structures can consume
 * excessive server resources.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/199
 *
 * @param config - Complexity configuration (uses defaults if not provided)
 * @returns ValidationRule function to pass to GraphQL validationRules
 */
export function createQueryComplexityValidationRule(
  config: Partial<IQueryComplexityConfig> = {},
) {
  const mergedConfig = { ...DEFAULT_QUERY_COMPLEXITY_CONFIG, ...config };

  return createComplexityRule({
    maximumComplexity: mergedConfig.maxComplexity,
    estimators: [
      // Use field extensions for custom complexity hints on resolvers
      // Example: @Directive('@complexity(value: 50)')
      fieldExtensionsEstimator(),
      // Fall back to simple estimation based on config
      simpleEstimator({
        defaultComplexity: mergedConfig.scalarCost,
      }),
    ],
    onComplete: (complexity: number) => {
      if (mergedConfig.logComplexity) {
        logger.debug(
          `Query complexity: ${complexity} (max: ${mergedConfig.maxComplexity})`,
        );
      }
    },
    createError: (max: number, actual: number) => {
      logger.warn(
        `Query rejected: complexity ${actual} exceeds maximum ${max}`,
      );
      return new GraphQLError(
        `Query complexity of ${actual} exceeds maximum allowed complexity of ${max}. ` +
          `Please simplify your query by requesting fewer fields or reducing nesting.`,
        {
          extensions: {
            code: 'QUERY_COMPLEXITY_EXCEEDED',
            complexity: actual,
            maxComplexity: max,
          },
        },
      );
    },
  });
}

/**
 * Apollo Server Plugin for Query Complexity Logging
 *
 * Optional plugin that logs query complexity for monitoring purposes.
 * Use this in addition to the validation rule if you want async logging
 * or additional monitoring.
 */
export function createQueryComplexityLoggingPlugin(): ApolloServerPlugin<BaseContext> {
  return {
    async requestDidStart() {
      const startTime = Date.now();
      return {
        async willSendResponse() {
          const duration = Date.now() - startTime;
          if (duration > 1000) {
            logger.warn(`Slow query detected: ${duration}ms`);
          }
        },
      };
    },
  };
}

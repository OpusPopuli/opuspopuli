import { ApolloServerPlugin, BaseContext } from '@apollo/server';
import { GraphQLError } from 'graphql';
import {
  getComplexity,
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
 * Creates an Apollo Server plugin for query complexity limiting.
 *
 * SECURITY: Prevents DoS attacks by limiting the complexity of GraphQL queries.
 * Complex queries with many fields or deeply nested structures can consume
 * excessive server resources.
 *
 * NOTE: This is implemented as a plugin (not a validation rule) because
 * graphql-query-complexity's createComplexityRule calls getVariableValues()
 * during the validation phase without access to the actual request variables,
 * causing all mutations/queries with required variables to fail validation.
 * As a plugin, we have access to request.variables via the request context.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/199
 *
 * @param config - Complexity configuration (uses defaults if not provided)
 * @returns Apollo Server plugin
 */
export function createQueryComplexityPlugin(
  config: Partial<IQueryComplexityConfig> = {},
): ApolloServerPlugin<BaseContext> {
  const mergedConfig = { ...DEFAULT_QUERY_COMPLEXITY_CONFIG, ...config };

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(requestContext) {
          const { schema, document, request } = requestContext;

          const complexity = getComplexity({
            schema,
            query: document,
            variables: request.variables ?? {},
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({
                defaultComplexity: mergedConfig.scalarCost,
              }),
            ],
          });

          if (mergedConfig.logComplexity) {
            logger.debug(
              `Query complexity: ${complexity} (max: ${mergedConfig.maxComplexity})`,
            );
          }

          if (complexity > mergedConfig.maxComplexity) {
            logger.warn(
              `Query rejected: complexity ${complexity} exceeds maximum ${mergedConfig.maxComplexity}`,
            );
            throw new GraphQLError(
              `Query complexity of ${complexity} exceeds maximum allowed complexity of ${mergedConfig.maxComplexity}. ` +
                `Please simplify your query by requesting fewer fields or reducing nesting.`,
              {
                extensions: {
                  code: 'QUERY_COMPLEXITY_EXCEEDED',
                  complexity,
                  maxComplexity: mergedConfig.maxComplexity,
                },
              },
            );
          }
        },
      };
    },
  };
}

import { registerAs } from '@nestjs/config';

/**
 * Query Complexity Configuration
 *
 * Configures GraphQL query complexity and depth limiting to prevent DoS attacks.
 * Complex or deeply nested queries can consume excessive server resources.
 *
 * SECURITY: Limits query depth and complexity to prevent resource exhaustion attacks.
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/199
 */
export interface IQueryComplexityConfig {
  /** Maximum query depth allowed (default: 10) */
  maxDepth: number;
  /** Maximum query complexity score allowed (default: 1000) */
  maxComplexity: number;
  /** Cost per scalar field (default: 1) */
  scalarCost: number;
  /** Cost per object field (default: 10) */
  objectCost: number;
  /** Multiplier for list fields (default: 10) */
  listFactor: number;
  /** Whether to log query complexity for monitoring */
  logComplexity: boolean;
}

export default registerAs(
  'queryComplexity',
  (): IQueryComplexityConfig => ({
    maxDepth: Number.parseInt(process.env.GRAPHQL_MAX_DEPTH || '10', 10),
    maxComplexity: Number.parseInt(
      process.env.GRAPHQL_MAX_COMPLEXITY || '1000',
      10,
    ),
    scalarCost: Number.parseInt(process.env.GRAPHQL_SCALAR_COST || '1', 10),
    objectCost: Number.parseInt(process.env.GRAPHQL_OBJECT_COST || '10', 10),
    listFactor: Number.parseInt(process.env.GRAPHQL_LIST_FACTOR || '10', 10),
    logComplexity: process.env.GRAPHQL_LOG_COMPLEXITY === 'true',
  }),
);

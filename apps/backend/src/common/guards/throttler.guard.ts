import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';

/**
 * GraphQL-aware Throttler Guard
 *
 * Extends the default ThrottlerGuard to work with GraphQL context.
 * Extracts the HTTP request and response from GraphQL execution context.
 * For federated subgraphs, the request may come from the gateway without
 * a full HTTP context, so we create a mock response if needed.
 *
 * Also logs rate limit violations for security monitoring.
 * @see https://github.com/OpusPopuli/opuspopuli/issues/187
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(GqlThrottlerGuard.name);

  /**
   * Get the request object from the execution context.
   * For GraphQL, we need to extract it from the GQL context.
   */
  protected getRequestResponse(context: ExecutionContext) {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();

    // For federated subgraphs, req/res may not be available
    // Create mock objects if needed for throttler compatibility
    const req = ctx.req || { ip: '127.0.0.1', headers: {} };
    const res = ctx.res || {
      header: () => res,
      setHeader: () => res,
    };

    return { req, res };
  }

  /**
   * Override to log rate limit violations before throwing exception
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();
    const info = gqlCtx.getInfo();

    const ip =
      ctx.req?.ip ||
      (ctx.req?.headers as Record<string, string>)?.['x-forwarded-for'] ||
      'unknown';
    const operationName = info?.fieldName || 'unknown';

    this.logger.warn(
      `Rate limit exceeded: ${operationName} from IP ${ip} - ` +
        `Limit: ${throttlerLimitDetail.limit}/${throttlerLimitDetail.ttl}ms, ` +
        `Total hits: ${throttlerLimitDetail.totalHits}`,
    );

    throw new ThrottlerException(`Too many requests. Please try again later.`);
  }
}

import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { GATEWAY_THROTTLER_CONFIG } from '../config/shared-app.config';
import { rateLimitKey, resolveClientIp } from '../utils/client-ip';
import { maskIpAddress } from '../utils/pii-masker';

/** Bound on remembered warnings; cleared wholesale rather than tracked. */
const MAX_WARN_ENTRIES = 10_000;

/** One throttler tier: at most `limit` requests per `ttl` milliseconds. */
export interface RateLimitTier {
  readonly name: string;
  readonly ttl: number;
  readonly limit: number;
}

/**
 * Per-client rate limit on the gateway's GraphQL endpoint (#1456).
 *
 * The gateway's `ThrottlerGuard` never sees a GraphQL operation. Apollo
 * Gateway executes queries itself, not through Nest resolvers, so Nest
 * guards run only on the gateway's REST routes. Before this middleware,
 * one client could send hundreds of queries a second (measured on UAT: 300
 * in 1.8 s, none refused). The only limit was the subgraphs' global cap,
 * which every user shares, so one client could spend it for everyone.
 *
 * Keyed on {@link resolveClientIp} (never the client-chosen first
 * `x-forwarded-for` hop), per IPv6 /64 by {@link rateLimitKey}. It uses the
 * module's throttler storage, the bounded `FixedWindowThrottlerStorage`, and
 * applies the same tiers the guard was meant to apply. It runs before CSRF and auth, so
 * a refused request costs as little as possible.
 */
@Injectable()
export class GraphqlRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GraphqlRateLimitMiddleware.name);
  private readonly tiers: readonly RateLimitTier[] = GATEWAY_THROTTLER_CONFIG;
  /** When each client was last warned about, per tier: one line per window. */
  private readonly lastWarned = new Map<string, number>();

  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = resolveClientIp(req.headers, req.ip);
    const key = rateLimitKey(ip);

    for (const tier of this.tiers) {
      // One key per tier: the storage keeps one "blocked" flag per key, so a
      // shared key would let the 1 s tier's block outlive its own window.
      const record = await this.storage.increment(
        `gql:${tier.name}:${key}`,
        tier.ttl,
        tier.limit,
        tier.ttl,
        tier.name,
      );
      if (record.isBlocked) {
        this.warnOnce(key, tier);
        this.refuse(res, tier, record.timeToBlockExpire);
        return;
      }
    }

    next();
  }

  /**
   * One warning per client, per tier, per window. A client hammering the
   * gateway is refused hundreds of times a second, and a line for each
   * refusal would turn every abuser into a flood in the log pipeline.
   */
  private warnOnce(client: string, tier: RateLimitTier): void {
    const key = `${tier.name}:${client}`;
    const now = Date.now();
    if (now - (this.lastWarned.get(key) ?? 0) < tier.ttl) return;
    if (this.lastWarned.size >= MAX_WARN_ENTRIES) this.lastWarned.clear();
    this.lastWarned.set(key, now);
    this.logger.warn(
      `GraphQL rate limit (${tier.name}: ${tier.limit}/${tier.ttl}ms) ` +
        `exceeded by ${maskIpAddress(client)}`,
    );
  }

  private refuse(
    res: Response,
    tier: RateLimitTier,
    secondsToExpire: number,
  ): void {
    res
      .status(429)
      .setHeader('Retry-After', String(Math.max(1, Math.ceil(secondsToExpire))))
      .json({
        errors: [
          {
            message: 'Too many requests. Please try again later.',
            extensions: { code: 'TOO_MANY_REQUESTS' },
          },
        ],
      });
  }
}

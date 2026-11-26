import { Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import {
  EDGE_READ_THROTTLER_CONFIG,
  GATEWAY_THROTTLER_CONFIG,
} from '../config/shared-app.config';
import {
  EDGE_READ_HEADER,
  verifyEdgeRead,
} from '../rate-limit/edge-read-signature';
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
 *
 * A GET signed by the frontend's Worker ({@link verifyEdgeRead}) is counted
 * against one shared edge-read budget instead of its address, which every
 * Cloudflare Worker shares. Only a GET: a signature never buys a mutation.
 * With no `EDGE_READ_SIGNING_SECRET` configured, nothing is signed-for and
 * every request is keyed on its client, as before.
 */
@Injectable()
export class GraphqlRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GraphqlRateLimitMiddleware.name);
  private readonly tiers: readonly RateLimitTier[] = GATEWAY_THROTTLER_CONFIG;
  private readonly edgeTiers: readonly RateLimitTier[] =
    EDGE_READ_THROTTLER_CONFIG;
  private readonly edgeSecret: string | undefined;
  /** When each client was last warned about, per tier: one line per window. */
  private readonly lastWarned = new Map<string, number>();

  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    @Optional() config?: ConfigService,
  ) {
    this.edgeSecret = config?.get<string>('EDGE_READ_SIGNING_SECRET');
  }

  /** The budget this request draws on: its client's, or the edge reads'. */
  private budgetFor(req: Request): {
    key: string;
    tiers: readonly RateLimitTier[];
  } {
    const signed =
      req.method === 'GET' &&
      verifyEdgeRead(
        req.headers[EDGE_READ_HEADER],
        this.edgeSecret,
        req.originalUrl ?? req.url,
      );
    if (signed) return { key: 'edge-read', tiers: this.edgeTiers };
    return {
      key: rateLimitKey(resolveClientIp(req.headers, req.ip)),
      tiers: this.tiers,
    };
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { key, tiers } = this.budgetFor(req);

    for (const tier of tiers) {
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

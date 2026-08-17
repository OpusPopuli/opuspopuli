import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { LogLevel } from '@opuspopuli/logging-provider';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from '../exceptions/all-exceptions.filter';
import { GraphQLExceptionFilter } from '../exceptions/graphql-exception.filter';
import { RolesGuard } from '../guards/roles.guard';
import { GqlThrottlerGuard } from '../guards/throttler.guard';
import { PoliciesGuard } from '../guards/policies.guard';
import { GracefulShutdownService } from '../services/graceful-shutdown.service';

/**
 * Whether introspection should be enabled for GraphQL services.
 * Disabled in production to prevent schema enumeration attacks.
 * @see https://github.com/OpusPopuli/opuspopuli/issues/378
 */
export const GRAPHQL_INTROSPECTION_ENABLED =
  process.env.NODE_ENV !== 'production';

/**
 * Shared Apollo Server plugins for all subgraph services.
 * Includes inline tracing and an introspection audit log plugin.
 */
export function createSubgraphPlugins(serviceName: string) {
  return [
    ApolloServerPluginInlineTrace(),
    {
      async serverWillStart() {
        if (!GRAPHQL_INTROSPECTION_ENABLED) {
          new Logger(serviceName).log(
            'GraphQL introspection is disabled (production mode)',
          );
        }
      },
    },
  ];
}

/**
 * Read PROMPT_SERVICE_URL, refusing to boot in production without it.
 *
 * THE INCIDENT THIS EXISTS FOR. `docker-compose-prompt-service.yml` is an
 * OVERLAY: it defines the prompt-service containers AND injects
 * PROMPT_SERVICE_URL into the six services that need it. A deploy run with
 * only `-f docker-compose-prod.yml` silently drops both halves — the services
 * start, report healthy, and are simply unable to reach prompt-service.
 *
 * Nothing failed. Prompt fetches fell back, produced nothing, and the empty
 * results were cached with a 7-day TTL. Every relevance explanation on the
 * platform — committees, bills, propositions, representatives — went blank,
 * with no error anywhere: 484 empty cache rows against ONE with content. The
 * user-visible symptom was a briefing section quietly rendering zero items.
 *
 * A missing prompt service must therefore be impossible to deploy past. In
 * production this throws, so an incomplete deploy fails at boot, in front of
 * whoever is running it, instead of a week later as a silently empty feature.
 * That is deliberately a harder failure than degrading: this outage was
 * expensive precisely because it was survivable.
 *
 * Outside production it warns and returns undefined, so local work without a
 * prompt-service continues to run against fallbacks.
 */
export function requirePromptServiceUrl(
  config: ConfigService,
  serviceName: string,
): string | undefined {
  const url = config.get<string>('PROMPT_SERVICE_URL');
  if (url) return url;

  const message =
    `${serviceName}: PROMPT_SERVICE_URL is not set. This service cannot ` +
    'generate AI content without it, and would degrade silently rather than ' +
    'fail. If deploying the node stack, layer the prompt-service overlay:\n' +
    '  ./bin/op-compose -f docker-compose-prod.yml ' +
    '-f docker-compose-prompt-service.yml up -d';

  if (config.get('NODE_ENV') === 'production') {
    throw new Error(message);
  }

  new Logger(serviceName).warn(`${message}\n(non-production: continuing)`);
  return undefined;
}

/**
 * Rate limits for the API GATEWAY — the public edge.
 *
 * This is the throttler that matters: it keys on the real client IP, so it is
 * the only one that can distinguish one abusive caller from everyone else.
 *
 * Sized against what a page load actually costs. One briefing load fans out to
 * ~21 queries in about two seconds, with 11 inside a single second. At the
 * previous 10/s that tripped on first sign-in every time, surfacing as "Too
 * many requests" in the Representatives section and a phantom "0 committees"
 * where the query was rejected before it ran.
 *
 * Note these are still per IP, so users behind shared NAT — an office, a
 * library, a household — spend one budget collectively. Reducing the fan-out
 * (see #1024) is what actually fixes that; these numbers only buy room.
 */
export const GATEWAY_THROTTLER_CONFIG = [
  {
    name: 'short',
    ttl: 1000, // 1 second
    limit: 50, // ~2 briefing loads' worth of burst
  },
  {
    name: 'medium',
    ttl: 10000, // 10 seconds
    limit: 200, // ~9 page loads in 10s
  },
  {
    name: 'long',
    ttl: 60000, // 1 minute
    limit: 600, // ~28 page loads/min — brisk human use, not a script
  },
];

/**
 * Rate limits for the SUBGRAPHS — internal services behind the gateway.
 *
 * These are deliberately far higher than the gateway's, because the throttler
 * keys on IP and **every subgraph request arrives from the gateway's single
 * IP**. There is no per-user dimension here at all: the limit is a global cap
 * on total system throughput, shared by every user at once.
 *
 * At the previous 10/s that meant the whole platform could serve ten subgraph
 * requests per second across all users combined — while ONE briefing load
 * needs about 21. It held together only because there was effectively one
 * person using it; a second concurrent user would have throttled both.
 *
 * These limits also provide no security. Subgraphs are not publicly reachable
 * and require a valid `X-HMAC-Auth` signature, so an attacker who could reach
 * them at volume has already defeated something more important than a rate
 * limit. The real per-caller control is GATEWAY_THROTTLER_CONFIG above.
 *
 * Kept non-infinite purely as a runaway backstop — a bug that loops subgraph
 * calls should eventually be stopped rather than allowed to saturate the
 * database.
 */
export const THROTTLER_CONFIG = [
  {
    name: 'short',
    ttl: 1000, // 1 second
    limit: 2000, // global across all users, not per user
  },
  {
    name: 'medium',
    ttl: 10000, // 10 seconds
    limit: 10000,
  },
  {
    name: 'long',
    ttl: 60000, // 1 minute
    limit: 50000,
  },
];

/**
 * Shared providers for all microservices (guards and filters)
 *
 * Note: AllExceptionsFilter must be registered first (processed last)
 * to catch any unhandled exceptions after more specific filters.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/190
 */
export const SHARED_PROVIDERS = [
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
  { provide: APP_FILTER, useClass: GraphQLExceptionFilter },
  { provide: APP_GUARD, useClass: GqlThrottlerGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: PoliciesGuard },
  // INFRA-003: Graceful shutdown service for Kubernetes SIGTERM handling
  GracefulShutdownService,
];

/**
 * Factory function for LoggingModule configuration
 */
export function createLoggingConfig(serviceName: string) {
  return {
    imports: [],
    useFactory: (configService: ConfigService) => ({
      serviceName,
      level:
        configService.get('NODE_ENV') === 'production'
          ? LogLevel.INFO
          : LogLevel.DEBUG,
      format:
        configService.get('NODE_ENV') === 'production'
          ? ('json' as const)
          : ('pretty' as const),
    }),
    inject: [ConfigService],
  };
}

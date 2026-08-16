import { ConfigService } from '@nestjs/config';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';

/**
 * Calling the users subgraph directly, bypassing the federated router.
 *
 * Both auth routes on this gateway need it for the same reason: the mutations
 * they call are `@inaccessible`, so they are absent from the composed public
 * schema and unreachable through `/api` by design. That keeps a 7-day refresh
 * token and a live access token out of client-facing GraphQL, where they would
 * land in query logs, traces and audit payloads.
 *
 * Extracted because the refresh and logout controllers were otherwise
 * byte-identical here — URL lookup, HMAC header, POST, parse — which the CPD
 * gate correctly rejected. Keeping one copy also means the HMAC signing step
 * cannot be added to one caller and forgotten in the other.
 */
export interface SubgraphConfig {
  name: string;
  url: string;
}

export interface GraphQLErrorShape {
  message: string;
  extensions?: { code?: string };
}

export interface SubgraphResponse<T> {
  data?: T;
  errors?: GraphQLErrorShape[];
}

/**
 * Resolve the users subgraph URL from `MICROSERVICES`.
 *
 * Throws rather than defaulting: a missing entry is a deployment error, and a
 * guessed localhost URL would fail later and less clearly.
 */
export function getUsersSubgraphUrl(configService: ConfigService): string {
  const raw = configService.get<string>('MICROSERVICES');
  const subgraphs = JSON.parse(raw || '[]') as SubgraphConfig[];
  const users = subgraphs.find((s) => s.name === 'users');
  if (!users?.url) {
    throw new Error('No users subgraph configured in MICROSERVICES');
  }
  return users.url;
}

/**
 * POST an HMAC-signed operation to the users subgraph.
 *
 * Rejects on transport failure and on non-JSON responses; a GraphQL-level
 * error comes back in `errors` for the caller to interpret. That split matters
 * to both callers and they read it in opposite directions — refresh must tell
 * a rejected grant from an outage before deciding whether to clear cookies,
 * while logout clears them regardless and only logs what went wrong.
 */
export async function callUsersSubgraph<T>(
  configService: ConfigService,
  hmacSigner: HmacSignerService,
  query: string,
  variables: Record<string, unknown>,
): Promise<SubgraphResponse<T>> {
  const url = getUsersSubgraphUrl(configService);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (hmacSigner.isEnabled()) {
    headers['X-HMAC-Auth'] = hmacSigner.signGraphQLRequest(url);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return (await response.json()) as SubgraphResponse<T>;
}

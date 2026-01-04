# Authentication Security Guide

This guide explains the security architecture for authentication in QCKSTRT, including token management, CSRF protection, and the federated GraphQL architecture.

## Overview

QCKSTRT implements a layered security architecture:

1. **Browser → API Gateway**: CSRF protection + httpOnly cookies
2. **API Gateway → Microservices**: HMAC request signing
3. **No secrets in frontend**: All cryptographic operations happen server-side

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SECURITY ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Browser                    API Gateway                Microservices    │
│  ┌──────────┐               ┌──────────┐              ┌──────────────┐  │
│  │ Frontend │──CSRF+Cookie─▶│ Gateway  │───HMAC sig──▶│ Users/Docs   │  │
│  │(no       │  (httpOnly)   │(validates│  (gateway    │ (validates   │  │
│  │ secrets) │               │  CSRF)   │   signs)     │  HMAC)       │  │
│  └──────────┘               └──────────┘              └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Token Storage: httpOnly Cookies

### Why Not localStorage?

Storing JWT tokens in localStorage is vulnerable to XSS attacks:
- Any malicious JavaScript can read `localStorage.getItem('token')`
- Stolen tokens can be used from any device until they expire
- XSS vulnerabilities are common in modern web applications

### httpOnly Cookie Solution

Tokens are stored in httpOnly cookies, which:
- **Cannot be accessed by JavaScript** (immune to XSS token theft)
- **Automatically sent with every request** by the browser
- **Protected by SameSite attribute** against CSRF in modern browsers

### Cookie Configuration

```typescript
// Access token cookie (short-lived)
res.cookie('access-token', accessToken, {
  httpOnly: true,           // Not accessible to JavaScript
  secure: true,             // HTTPS only in production
  sameSite: 'strict',       // Strict same-site policy
  maxAge: 15 * 60 * 1000,   // 15 minutes
});

// Refresh token cookie (longer-lived)
res.cookie('refresh-token', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/auth/refresh', // Only sent to refresh endpoint
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});
```

## CSRF Protection

Since httpOnly cookies are automatically sent with requests, we need CSRF protection to prevent malicious sites from making authenticated requests on behalf of users.

### Stateless Double-Submit Cookie Pattern

This pattern doesn't require server-side session storage:

1. **Server sets a CSRF token cookie** (readable by JavaScript)
2. **Frontend reads the cookie** and includes it in a header
3. **Server validates** that the header matches the cookie

```
┌────────────────┐                    ┌────────────────┐
│    Browser     │                    │   API Gateway  │
├────────────────┤                    ├────────────────┤
│                │                    │                │
│  1. Response sets csrf-token cookie │                │
│  ◄──────────────────────────────────│                │
│                │                    │                │
│  2. JS reads csrf-token cookie      │                │
│  3. JS adds X-CSRF-Token header     │                │
│  ────────────────────────────────►  │                │
│                │                    │ 4. Validates   │
│                │                    │    header ==   │
│                │                    │    cookie      │
└────────────────┘                    └────────────────┘
```

### Why This Works

An attacker on `evil.com` cannot:
- **Read cookies** from `yourdomain.com` (same-origin policy)
- **Set the X-CSRF-Token header** with the correct value
- **Forge the cookie** because they can't read it

### Implementation

**Backend (CSRF Middleware)**:
```typescript
// apps/backend/src/common/middleware/csrf.middleware.ts
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Generate/refresh CSRF token on all requests
    let csrfToken = req.cookies[this.cookieName];
    if (!csrfToken) {
      csrfToken = crypto.randomUUID();
    }

    // Set cookie (readable by JS)
    res.cookie(this.cookieName, csrfToken, {
      httpOnly: false,  // JS needs to read this
      secure: this.isProduction,
      sameSite: 'strict',
    });

    // Validate on mutations (POST, PUT, DELETE)
    if (!this.isSafeMethod(req.method)) {
      const headerToken = req.headers[this.headerName];
      if (headerToken !== csrfToken) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }

    next();
  }
}
```

**Frontend (Apollo Client)**:
```typescript
// apps/frontend/lib/apollo-client.ts
function getCsrfToken(): string | undefined {
  const cookies = document.cookie.split('; ');
  const csrfCookie = cookies.find(c => c.startsWith('csrf-token='));
  return csrfCookie?.split('=')[1];
}

const customFetch: typeof fetch = async (uri, options) => {
  const headers = new Headers(options?.headers);

  // Add CSRF token from cookie
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  return fetch(uri, {
    ...options,
    headers,
    credentials: 'include', // Send cookies
  });
};
```

## Gateway-to-Microservice Authentication (HMAC)

Microservices should only accept requests from the API Gateway, not directly from browsers or other sources.

### HMAC Request Signing

The API Gateway signs every request to microservices:

```typescript
// apps/backend/src/common/services/hmac-signer.service.ts
@Injectable()
export class HmacSignerService {
  signGraphQLRequest(url: string): string {
    const timestamp = Date.now();
    const signatureString = `${timestamp}:${url}`;

    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(signatureString)
      .digest('base64');

    return JSON.stringify({
      username: this.clientId,
      algorithm: 'hmac-sha256',
      timestamp,
      signature,
    });
  }
}
```

### Microservice Validation

Each microservice validates the HMAC signature:

```typescript
// apps/backend/src/common/middleware/hmac.middleware.ts
@Injectable()
export class HMACMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const hmacHeader = req.headers['x-hmac-auth'];

    // Validate signature
    const { username, timestamp, signature } = JSON.parse(hmacHeader);
    const expectedSignature = this.calculateSignature(timestamp, url);

    if (!this.timingSafeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    // Check timestamp to prevent replay attacks
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      throw new UnauthorizedException('Request expired');
    }

    next();
  }
}
```

## Cookie Propagation in Federated GraphQL

In Apollo Federation, subgraphs respond to the gateway, not directly to the browser. This means cookies set by subgraphs (like the Users service during login) need to be propagated through the gateway.

### The Problem

```
Browser → Gateway → Users Service (sets cookie)
                          │
                          └── Cookie goes to Gateway, not Browser!
```

### The Solution

The `HmacRemoteGraphQLDataSource` intercepts subgraph responses and propagates `Set-Cookie` headers:

```typescript
// apps/backend/src/api/src/hmac-data-source.ts
export class HmacRemoteGraphQLDataSource extends RemoteGraphQLDataSource {
  didReceiveResponse(requestContext: any): any {
    const { response, context } = requestContext;
    const httpResponse = response?.http;

    if (httpResponse && context?.res) {
      // Propagate Set-Cookie headers from subgraph to browser
      const setCookieHeaders = httpResponse.headers?.get?.('set-cookie');
      if (setCookieHeaders) {
        const cookies = this.parseSetCookieHeaders(setCookieHeaders);
        cookies.forEach((cookie: string) => {
          context.res?.append('Set-Cookie', cookie);
        });
      }
    }

    return response;
  }
}
```

### Flow After Fix

```
Browser → Gateway → Users Service (sets cookie)
    ↑        │              │
    │        │              └── Set-Cookie header
    │        │
    │        └── Gateway propagates Set-Cookie to browser
    │
    └── Cookie stored in browser
```

## Configuration

### Environment Variables

```bash
# CSRF Protection
CSRF_ENABLED=true
CSRF_COOKIE_NAME='csrf-token'
CSRF_HEADER_NAME='x-csrf-token'
CSRF_TOKEN_MAX_AGE=86400000

# Cookie Configuration
COOKIE_SECURE=true                     # Require HTTPS
COOKIE_SAME_SITE='strict'              # strict, lax, or none
COOKIE_DOMAIN='.yourdomain.com'        # Include subdomains
COOKIE_ACCESS_TOKEN_MAX_AGE=900000     # 15 minutes
COOKIE_REFRESH_TOKEN_MAX_AGE=604800000 # 7 days

# Gateway HMAC (microservice authentication)
GATEWAY_HMAC_SECRET='your-secure-secret'
GATEWAY_CLIENT_ID='api-gateway'
```

### Production Checklist

- [ ] `COOKIE_SECURE=true` (HTTPS only)
- [ ] `COOKIE_SAME_SITE='strict'`
- [ ] Strong `GATEWAY_HMAC_SECRET` (use `openssl rand -base64 32`)
- [ ] CSRF enabled (`CSRF_ENABLED=true`)
- [ ] All microservices have `HMACMiddleware` configured
- [ ] No secrets in frontend environment variables
- [ ] GraphQL depth limiting enabled (default: 10)
- [ ] GraphQL complexity limiting enabled (default: 1000)

## GraphQL Query Complexity & Depth Limiting

GraphQL's flexible query language allows clients to request deeply nested or computationally expensive queries, which can lead to denial-of-service attacks.

### The Problem

```graphql
# Malicious query that could exhaust server resources
query MaliciousQuery {
  users {
    posts {
      comments {
        author {
          posts {
            comments {
              # ... deeply nested to consume CPU/memory
            }
          }
        }
      }
    }
  }
}
```

### Solution: Depth & Complexity Limiting

All GraphQL subgraphs enforce:

1. **Query Depth Limit** (max 10 levels) - Prevents deeply nested queries
2. **Query Complexity Limit** (max 1000 points) - Limits expensive field combinations

```typescript
// apps/backend/src/apps/*/src/app.module.ts
GraphQLModule.forRoot<ApolloFederationDriverConfig>({
  validationRules: [
    depthLimit(10),
    createQueryComplexityValidationRule(),
  ],
});
```

### Field Complexity Hints

Expensive operations have higher complexity costs:

| Operation | Complexity | Reason |
|-----------|------------|--------|
| `answerQuery` | 100 | LLM call |
| `searchText` | 50 | Vector search + embeddings |
| `indexDocument` | 50 | Embedding generation |
| `syncRegionData` | 100 | Full data sync |
| List operations | 15-20 | Database pagination |
| Scalar fields | 1 | Default cost |

```typescript
// Example: High complexity hint on expensive operation
@Mutation(() => String)
@UseGuards(AuthGuard)
@Extensions({ complexity: 100 }) // LLM call - expensive operation
async answerQuery(@Args('input') input: QueryInput): Promise<string> {
  return this.knowledgeService.answerQuery(input.query);
}
```

### Error Response

Queries exceeding limits receive clear error messages:

```json
{
  "errors": [{
    "message": "Query complexity of 1500 exceeds maximum allowed complexity of 1000. Please simplify your query by requesting fewer fields or reducing nesting.",
    "extensions": {
      "code": "QUERY_COMPLEXITY_EXCEEDED",
      "complexity": 1500,
      "maxComplexity": 1000
    }
  }]
}
```

### Configuration

```bash
# Environment variables (all optional with sensible defaults)
GRAPHQL_MAX_DEPTH=10          # Maximum query depth
GRAPHQL_MAX_COMPLEXITY=1000   # Maximum complexity score
GRAPHQL_SCALAR_COST=1         # Cost per scalar field
GRAPHQL_OBJECT_COST=10        # Cost per object field
GRAPHQL_LIST_FACTOR=10        # Multiplier for list fields
GRAPHQL_LOG_COMPLEXITY=true   # Enable complexity logging
```

## Security Benefits

| Threat | Protection |
|--------|------------|
| XSS token theft | httpOnly cookies (JS can't read tokens) |
| CSRF attacks | Double-submit cookie pattern |
| Direct microservice access | HMAC signature validation |
| Replay attacks | Timestamp validation in HMAC |
| Secret exposure | All secrets server-side only |
| GraphQL DoS (deep queries) | Query depth limiting (max 10) |
| GraphQL DoS (expensive queries) | Query complexity limiting (max 1000) |

## Troubleshooting

### "Invalid CSRF token" Error

1. Check that the frontend is sending `credentials: 'include'`
2. Verify the `X-CSRF-Token` header is being set
3. Ensure cookies are being sent (check DevTools → Network → Cookies)

### Cookies Not Being Set

1. In development, ensure `COOKIE_SECURE=false` for HTTP
2. Check for CORS issues (credentials require specific origin, not `*`)
3. Verify `SameSite` attribute matches your deployment

### HMAC Validation Failing

1. Ensure `GATEWAY_HMAC_SECRET` matches between gateway and microservices
2. Check server clocks are synchronized (timestamp validation)
3. Verify the `X-HMAC-Auth` header is being sent

## Related Documentation

- [System Overview](../architecture/system-overview.md) - High-level architecture
- [Provider Pattern](../architecture/provider-pattern.md) - Auth provider details
- [Supabase Setup](supabase-setup.md) - Supabase Auth configuration
- [Getting Started](getting-started.md) - Development setup

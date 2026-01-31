import {
  GraphQLDataSourceProcessOptions,
  RemoteGraphQLDataSource,
} from '@apollo/gateway';
import type { Response } from 'express';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import { MetricsService } from 'src/common/metrics';

/**
 * Gateway context passed to data source
 * Includes Express response for cookie propagation in federated architecture
 */
interface GatewayContext {
  user?: string;
  res?: Response;
}

/**
 * Custom RemoteGraphQLDataSource that adds HMAC authentication to requests
 * and propagates Set-Cookie headers from subgraphs to the browser.
 *
 * In Apollo Federation, subgraphs respond to the gateway, not directly to the browser.
 * This class ensures:
 * 1. Requests to subgraphs are signed with HMAC for authentication
 * 2. Set-Cookie headers from subgraph responses are propagated to the browser
 * 3. Subgraph request latency is tracked via Prometheus metrics
 *
 * SECURITY: This replaces the frontend HMAC signing (which exposed secrets
 * in the browser) with gateway-side signing.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/185
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/186
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/213
 */
export class HmacRemoteGraphQLDataSource extends RemoteGraphQLDataSource<GatewayContext> {
  private readonly hmacSigner: HmacSignerService;
  private readonly metricsService?: MetricsService;
  private readonly subgraphName: string;
  // Track request start times for latency measurement
  private readonly requestStartTimes = new WeakMap<object, bigint>();

  constructor(
    config: { url?: string },
    hmacSigner: HmacSignerService,
    metricsService?: MetricsService,
  ) {
    super(config);
    this.hmacSigner = hmacSigner;
    this.metricsService = metricsService;
    // Extract subgraph name from URL (e.g., http://localhost:4001 -> users-service)
    this.subgraphName = this.extractSubgraphName(config.url);
  }

  /**
   * Extract a readable subgraph name from the URL
   */
  private extractSubgraphName(url?: string): string {
    if (!url) return 'unknown';
    try {
      const parsed = new URL(url);
      // Use port to identify service in local dev, or hostname in production
      const port = parsed.port;
      const portToService: Record<string, string> = {
        '4001': 'users-service',
        '4002': 'documents-service',
        '4003': 'knowledge-service',
        '4004': 'region-service',
      };
      return portToService[port] || parsed.hostname || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  willSendRequest({
    request,
    context,
  }: GraphQLDataSourceProcessOptions<GatewayContext>) {
    // Track request start time for latency metrics
    if (this.metricsService && request) {
      this.requestStartTimes.set(request, process.hrtime.bigint());
    }

    // Forward authenticated user to microservices
    if (context?.user) {
      request.http?.headers.set('user', context.user);
    }

    // Sign request with HMAC for microservice authentication
    if (this.hmacSigner.isEnabled() && request.http?.url) {
      const hmacHeader = this.hmacSigner.signGraphQLRequest(request.http.url);
      if (hmacHeader) {
        request.http?.headers.set('X-HMAC-Auth', hmacHeader);
      }
    }
  }

  /**
   * Propagate Set-Cookie headers from subgraph responses to the browser.
   *
   * In a federated architecture, auth mutations (login, logout, etc.) set cookies
   * in the subgraph response. These need to be forwarded to the browser through
   * the gateway response.
   *
   * SECURITY: Only Set-Cookie headers are propagated to maintain proper
   * cookie-based authentication in a federated setup.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  didReceiveResponse(requestContext: any): any {
    const { response, context, request } = requestContext;

    // Record subgraph latency metric
    if (this.metricsService && request) {
      const startTime = this.requestStartTimes.get(request);
      if (startTime) {
        const durationNs = process.hrtime.bigint() - startTime;
        const durationSeconds = Number(durationNs) / 1e9;
        this.metricsService.recordSubgraphRequest(
          this.subgraphName,
          durationSeconds,
        );
        this.requestStartTimes.delete(request);
      }
    }

    // Get the HTTP response from the subgraph
    const httpResponse = response?.http;

    if (httpResponse && context?.res) {
      // Propagate Set-Cookie headers from subgraph to browser
      const setCookieHeaders = httpResponse.headers?.get?.('set-cookie');
      if (setCookieHeaders) {
        // The header can contain multiple cookies separated by comma
        // but some cookies contain commas in their values (e.g., expires dates)
        // So we need to be careful about splitting
        const cookies = this.parseSetCookieHeaders(setCookieHeaders);
        cookies.forEach((cookie: string) => {
          context.res?.append('Set-Cookie', cookie);
        });
      }
    }

    return response;
  }

  /**
   * Parse Set-Cookie header value into individual cookies.
   *
   * Set-Cookie headers can be combined with commas, but cookie values
   * may also contain commas (e.g., in expires dates). This parser handles
   * both cases correctly.
   */
  private parseSetCookieHeaders(headerValue: string): string[] {
    const cookies: string[] = [];
    let currentCookie = '';

    // Split on comma, but not commas within expires/date values
    for (let i = 0; i < headerValue.length; i++) {
      const char = headerValue[i];

      if (char === ',') {
        // Check if this comma is part of a date (look for day name pattern)
        const before = headerValue.slice(Math.max(0, i - 5), i);
        const after = headerValue.slice(i + 1, i + 10);

        // If this looks like a date separator (e.g., "Mon, 01-Jan"), don't split
        if (/\w{3}$/.test(before) && /^\s*\d{2}/.test(after)) {
          currentCookie += char;
        } else {
          if (currentCookie.trim()) {
            cookies.push(currentCookie.trim());
          }
          currentCookie = '';
        }
      } else {
        currentCookie += char;
      }
    }

    if (currentCookie.trim()) {
      cookies.push(currentCookie.trim());
    }

    return cookies;
  }
}

import { registerAs } from '@nestjs/config';

/**
 * WebSocket Configuration
 *
 * Configures WebSocket settings for GraphQL subscriptions.
 *
 * SECURITY: WebSocket connections require JWT authentication via connection params.
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
 */
export interface IWebSocketConfig {
  /** Enable GraphQL subscriptions via WebSocket */
  enabled: boolean;
  /** WebSocket path (default: same as GraphQL endpoint) */
  path: string;
  /** Connection keep-alive interval in ms (for detecting stale connections) */
  keepAlive: number;
  /** Maximum connection duration in ms (0 = unlimited) */
  connectionTimeout: number;
}

export default registerAs(
  'websocket',
  (): IWebSocketConfig => ({
    enabled: process.env.WEBSOCKET_ENABLED === 'true',
    path: process.env.WEBSOCKET_PATH || 'api',
    keepAlive: Number.parseInt(process.env.WEBSOCKET_KEEP_ALIVE || '30000', 10),
    connectionTimeout: Number.parseInt(
      process.env.WEBSOCKET_CONNECTION_TIMEOUT || '0',
      10,
    ),
  }),
);

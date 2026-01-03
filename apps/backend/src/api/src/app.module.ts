import { IntrospectAndCompose } from '@apollo/gateway';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';

import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LoggingModule, LogLevel } from '@qckstrt/logging-provider';

import configuration from 'src/config';
import supabaseConfig from 'src/config/supabase.config';
import storageConfig from 'src/config/storage.config';
import authConfig from 'src/config/auth.config';
import secretsConfig from 'src/config/secrets.config';
import relationaldbConfig from 'src/config/relationaldb.config';
import csrfConfig from 'src/config/csrf.config';
import cookieConfig from 'src/config/cookie.config';
import websocketConfig, { IWebSocketConfig } from 'src/config/websocket.config';
import { getGraphQLCorsConfig } from 'src/config/cors.config';

import { CsrfMiddleware } from 'src/common/middleware/csrf.middleware';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from 'src/common/auth/jwt.strategy';
import { WebSocketAuthService } from 'src/common/auth/websocket-auth.service';
import { AuthMiddleware } from 'src/common/middleware/auth.middleware';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AllExceptionsFilter } from 'src/common/exceptions/all-exceptions.filter';
import { HttpExceptionFilter } from 'src/common/exceptions/http-exception.filter';
import { HealthModule } from './health/health.module';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import { HmacRemoteGraphQLDataSource } from './hmac-data-source';

/**
 * Extract authenticated user from request context for GraphQL operations.
 *
 * SECURITY: Only trusts req.user which is set by AuthMiddleware after JWT validation.
 * Never trusts req.headers.user as it can be spoofed by clients.
 *
 * The response object is included in context to allow propagation of Set-Cookie
 * headers from subgraphs back to the browser in a federated architecture.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/182
 */
const handleAuth = ({ req, res }: { req: Request; res: Response }) => {
  // Only use the validated user from passport (set by AuthMiddleware after JWT validation)
  // req.user contains the ILogin object from JwtStrategy.validate()
  const context: { user?: string; res: Response } = { res };

  if (req.user) {
    // Serialize user object to JSON string for propagation to subgraphs
    context.user = JSON.stringify(req.user);
  }

  return context;
};

@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({
      load: [
        configuration,
        supabaseConfig,
        storageConfig,
        authConfig,
        secretsConfig,
        relationaldbConfig,
        csrfConfig,
        cookieConfig,
        websocketConfig,
      ],
      isGlobal: true,
    }),
    LoggingModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        serviceName: 'api-gateway',
        level:
          configService.get('NODE_ENV') === 'production'
            ? LogLevel.INFO
            : LogLevel.DEBUG,
        format:
          configService.get('NODE_ENV') === 'production' ? 'json' : 'pretty',
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 10000, // 10 seconds
        limit: 50, // 50 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),
    GraphQLModule.forRootAsync<ApolloGatewayDriverConfig>({
      driver: ApolloGatewayDriver,
      imports: [
        ConfigModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
      ],
      useFactory: async (
        configService: ConfigService,
        hmacSigner: HmacSignerService,
        wsAuthService: WebSocketAuthService,
      ) => {
        const wsConfig = configService.get<IWebSocketConfig>('websocket');

        return {
          server: {
            // SECURITY: Restrict CORS to allowed origins in production
            // In development, allows all origins for easier testing
            // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/189
            cors: getGraphQLCorsConfig(configService),
            path: 'api',
            context: handleAuth,
            // SECURITY: Disable introspection in production to prevent schema enumeration attacks
            introspection: configService.get('NODE_ENV') !== 'production',
          },
          gateway: {
            buildService: ({ url }) => {
              // Use custom data source that signs requests with HMAC
              // SECURITY: This ensures microservices only accept requests from the gateway
              // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/185
              return new HmacRemoteGraphQLDataSource({ url }, hmacSigner);
            },
            supergraphSdl: new IntrospectAndCompose({
              subgraphs: JSON.parse(
                configService.get('MICROSERVICES') as string | '',
              ),
            }),
          },
          // SECURITY: WebSocket subscription authentication
          // All WebSocket connections must provide a valid JWT in connection params
          // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
          subscriptions: wsConfig?.enabled
            ? {
                'graphql-ws': {
                  path: `/${wsConfig.path || 'api'}`,
                  onConnect: async (context: {
                    connectionParams?: Record<string, unknown>;
                  }) => {
                    const { connectionParams } = context;
                    if (!connectionParams) {
                      throw new Error('Missing connection parameters');
                    }

                    // Validate JWT and get authenticated user
                    const user =
                      await wsAuthService.authenticateConnection(
                        connectionParams,
                      );

                    // Return user context for use in subscriptions
                    return { user: JSON.stringify(user) };
                  },
                  onDisconnect: () => {
                    // Optional: Log disconnection for monitoring
                  },
                },
              }
            : undefined,
        };
      },
      inject: [ConfigService, HmacSignerService, WebSocketAuthService],
    }),
  ],
  providers: [
    // SECURITY: Exception filters for error sanitization
    // AllExceptionsFilter must be first (processed last) to catch unhandled exceptions
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // SECURITY: Global auth guard implements "deny by default"
    // All GraphQL operations require authentication unless marked with @Public()
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/183
    { provide: APP_GUARD, useClass: AuthGuard },
    JwtStrategy,
    // SECURITY: HMAC signer for gateway-to-microservice request authentication
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/185
    HmacSignerService,
    // SECURITY: WebSocket authentication for GraphQL subscriptions
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
    WebSocketAuthService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfMiddleware, AuthMiddleware)
      .exclude({ path: 'health', method: RequestMethod.GET })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

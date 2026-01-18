import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IRelationalDBProvider } from "@qckstrt/common";
import {
  PostgresProvider,
  PostgresConfig,
  PoolConfig,
} from "./providers/postgres.provider.js";
import { ConnectionRetryConfig } from "./types.js";

/**
 * Relational Database Module
 *
 * Configures Dependency Injection for relational database providers.
 *
 * Configure via RELATIONAL_DB_PROVIDER environment variable:
 * - postgres (default, via Supabase)
 *
 * Pool configuration via:
 * - RELATIONAL_DB_POOL_MAX (default: 20)
 * - RELATIONAL_DB_POOL_MIN (default: 5)
 * - RELATIONAL_DB_IDLE_TIMEOUT_MS (default: 30000)
 * - RELATIONAL_DB_CONNECTION_TIMEOUT_MS (default: 5000)
 * - RELATIONAL_DB_ACQUIRE_TIMEOUT_MS (default: 10000)
 *
 * Connection retry configuration via:
 * - RELATIONAL_DB_RETRY_MAX_ATTEMPTS (default: 5)
 * - RELATIONAL_DB_RETRY_BASE_DELAY_MS (default: 1000)
 * - RELATIONAL_DB_RETRY_MAX_DELAY_MS (default: 30000)
 * - RELATIONAL_DB_RETRY_USE_JITTER (default: true)
 */
@Module({
  providers: [
    {
      provide: "RELATIONAL_DB_PROVIDER",
      useFactory: (configService: ConfigService): IRelationalDBProvider => {
        const provider =
          configService.get<string>("relationaldb.provider") || "postgres";

        switch (provider.toLowerCase()) {
          case "postgres":
          case "postgresql":
          default: {
            // Read pool configuration
            const poolConfig: PoolConfig = {
              max: configService.get<number>("relationaldb.postgres.pool.max"),
              min: configService.get<number>("relationaldb.postgres.pool.min"),
              idleTimeoutMs: configService.get<number>(
                "relationaldb.postgres.pool.idleTimeoutMs",
              ),
              connectionTimeoutMs: configService.get<number>(
                "relationaldb.postgres.pool.connectionTimeoutMs",
              ),
              acquireTimeoutMs: configService.get<number>(
                "relationaldb.postgres.pool.acquireTimeoutMs",
              ),
            };

            // Remove undefined values so defaults are used
            const cleanPoolConfig = Object.fromEntries(
              Object.entries(poolConfig).filter(([, v]) => v !== undefined),
            ) as PoolConfig;

            // Read retry configuration
            const retryConfig: Partial<ConnectionRetryConfig> = {
              maxAttempts: configService.get<number>(
                "relationaldb.postgres.retry.maxAttempts",
              ),
              baseDelayMs: configService.get<number>(
                "relationaldb.postgres.retry.baseDelayMs",
              ),
              maxDelayMs: configService.get<number>(
                "relationaldb.postgres.retry.maxDelayMs",
              ),
              useJitter: configService.get<boolean>(
                "relationaldb.postgres.retry.useJitter",
              ),
            };

            // Remove undefined values so defaults are used
            const cleanRetryConfig = Object.fromEntries(
              Object.entries(retryConfig).filter(([, v]) => v !== undefined),
            ) as Partial<ConnectionRetryConfig>;

            const postgresConfig: PostgresConfig = {
              host:
                configService.get<string>("relationaldb.postgres.host") ||
                "localhost",
              port:
                configService.get<number>("relationaldb.postgres.port") || 5432,
              database:
                configService.get<string>("relationaldb.postgres.database") ||
                "postgres",
              username:
                configService.get<string>("relationaldb.postgres.username") ||
                "postgres",
              password:
                configService.get<string>("relationaldb.postgres.password") ||
                "postgres",
              ssl:
                configService.get<boolean>("relationaldb.postgres.ssl") ||
                false,
              pool:
                Object.keys(cleanPoolConfig).length > 0
                  ? cleanPoolConfig
                  : undefined,
              retry:
                Object.keys(cleanRetryConfig).length > 0
                  ? cleanRetryConfig
                  : undefined,
            };

            return new PostgresProvider(postgresConfig);
          }
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ["RELATIONAL_DB_PROVIDER"],
})
export class RelationalDBModule {}

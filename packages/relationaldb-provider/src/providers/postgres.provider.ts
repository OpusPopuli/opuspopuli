import { Injectable, Logger } from "@nestjs/common";
import { DataSourceOptions } from "typeorm";
import { IRelationalDBProvider, RelationalDBType } from "@qckstrt/common";
import {
  ConnectionRetryConfig,
  DEFAULT_CONNECTION_RETRY_CONFIG,
} from "../types.js";

/**
 * Connection pool configuration
 */
export interface PoolConfig {
  /**
   * Maximum number of connections in pool
   * Default: 20
   */
  max?: number;
  /**
   * Minimum number of connections in pool
   * Default: 5
   */
  min?: number;
  /**
   * Connection idle timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  idleTimeoutMs?: number;
  /**
   * Connection timeout in milliseconds
   * Default: 5000 (5 seconds)
   */
  connectionTimeoutMs?: number;
  /**
   * Acquire timeout - how long to wait for available connection in milliseconds
   * Default: 10000 (10 seconds)
   */
  acquireTimeoutMs?: number;
}

/**
 * PostgreSQL configuration
 */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  /**
   * Connection pool configuration
   */
  pool?: PoolConfig;
  /**
   * Connection retry configuration for initial connection
   */
  retry?: Partial<ConnectionRetryConfig>;
}

/**
 * Default pool configuration values
 */
export const DEFAULT_POOL_CONFIG: Required<PoolConfig> = {
  max: 20,
  min: 5,
  idleTimeoutMs: 30000, // 30 seconds
  connectionTimeoutMs: 5000, // 5 seconds
  acquireTimeoutMs: 10000, // 10 seconds
};

/**
 * PostgreSQL Provider (OSS)
 *
 * Standard PostgreSQL database for relational data.
 *
 * Setup:
 * 1. Install PostgreSQL: https://www.postgresql.org/download/
 * 2. Create database: createdb qckstrt
 * 3. Configure connection in config/default.yaml
 *
 * Or use Docker:
 * docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres
 *
 * Pros:
 * - Industry standard, battle-tested
 * - Rich ecosystem and extensions
 * - Excellent performance
 * - ACID compliant
 *
 * Cons:
 * - Requires server setup (unlike SQLite)
 * - More resource intensive for dev
 */
@Injectable()
export class PostgresProvider implements IRelationalDBProvider {
  private readonly logger = new Logger(PostgresProvider.name);
  private readonly poolConfig: Required<PoolConfig>;

  constructor(private readonly config: PostgresConfig) {
    // Merge provided pool config with defaults
    this.poolConfig = {
      ...DEFAULT_POOL_CONFIG,
      ...config.pool,
    };

    this.logger.log(
      `PostgreSQL provider initialized: ${config.username}@${config.host}:${config.port}/${config.database} ` +
        `(pool: min=${this.poolConfig.min}, max=${this.poolConfig.max})`,
    );
  }

  getName(): string {
    return "PostgreSQL";
  }

  getType(): RelationalDBType {
    return RelationalDBType.PostgreSQL;
  }

  getConnectionOptions(
    entities: DataSourceOptions["entities"],
  ): DataSourceOptions {
    return {
      type: "postgres",
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
      entities,
      synchronize: true, // Auto-create tables (disable in production!)
      logging: false,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      // Connection pool settings (pg library options)
      extra: {
        // Maximum number of connections in pool
        max: this.poolConfig.max,
        // Minimum number of connections in pool
        min: this.poolConfig.min,
        // Connection idle timeout (ms)
        idleTimeoutMillis: this.poolConfig.idleTimeoutMs,
        // Connection timeout (ms)
        connectionTimeoutMillis: this.poolConfig.connectionTimeoutMs,
        // Acquire timeout - how long to wait for available connection (ms)
        acquireTimeoutMillis: this.poolConfig.acquireTimeoutMs,
      },
    } as DataSourceOptions;
  }

  /**
   * Get the current pool configuration
   */
  getPoolConfig(): Required<PoolConfig> {
    return { ...this.poolConfig };
  }

  /**
   * Get the connection retry configuration
   */
  getRetryConfig(): ConnectionRetryConfig {
    return {
      ...DEFAULT_CONNECTION_RETRY_CONFIG,
      ...this.config.retry,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Basic availability check (could ping DB here)
      return true;
    } catch (error) {
      this.logger.error("PostgreSQL availability check failed:", error);
      return false;
    }
  }
}

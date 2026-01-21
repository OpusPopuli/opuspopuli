/**
 * Relational Database Types and Interfaces
 *
 * Strategy Pattern for relational database connections.
 * Uses PostgreSQL via Supabase with Prisma ORM.
 */

/**
 * Database types supported
 */
export enum RelationalDBType {
  PostgreSQL = "postgres",
}

/**
 * Environment detection helpers for provider packages
 */
export type Environment = "production" | "development" | "test";

export function getEnvironment(): Environment {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  switch (nodeEnv) {
    case "production":
    case "prod":
      return "production";
    case "test":
      return "test";
    case "development":
    case "dev":
    default:
      return "development";
  }
}

export function isProduction(): boolean {
  return getEnvironment() === "production";
}

export function isDevelopment(): boolean {
  return getEnvironment() === "development";
}

export function isTest(): boolean {
  return getEnvironment() === "test";
}

/**
 * Strategy interface for relational database providers
 *
 * This is an ORM-agnostic interface. The actual ORM implementation
 * (Prisma, TypeORM, Drizzle, etc.) is encapsulated within the provider package.
 */
export interface IRelationalDBProvider {
  /**
   * Get the provider name for logging
   */
  getName(): string;

  /**
   * Get the database type
   */
  getType(): RelationalDBType;

  /**
   * Check if provider is available (for development warnings)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Connect to the database
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the database
   */
  disconnect(): Promise<void>;
}

/**
 * Exception thrown when relational DB operations fail
 */
export class RelationalDBError extends Error {
  constructor(
    public provider: string,
    public originalError: Error,
  ) {
    super(`Relational DB error in ${provider}: ${originalError.message}`);
    this.name = "RelationalDBError";
  }
}

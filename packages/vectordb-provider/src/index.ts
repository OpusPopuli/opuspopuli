/**
 * @opuspopuli/vectordb-provider
 *
 * Vector database provider implementations for the Opus Populi platform.
 * Uses PostgreSQL with pgvector extension via the shared DbService connection.
 *
 * To add custom providers, implement IVectorDBProvider interface.
 */

// Re-export types from common
export {
  IVectorDBProvider,
  IVectorDocument,
  IVectorQueryResult,
  VectorDBError,
} from "@opuspopuli/common";

// Types
export type { IRawQueryClient } from "./types.js";

// Provider implementations
export { PgVectorProvider } from "./providers/pgvector.provider.js";

// NestJS module
export { VectorDBModule } from "./vectordb.module.js";

import { registerAs } from "@nestjs/config";

/**
 * Vector Database Configuration
 *
 * Maps VECTORDB_* environment variables to nested config.
 */
export const vectordbConfig = registerAs("vectordb", () => ({
  // 768 since the nomic cutover (#1156). Must agree with EMBEDDING_DIMENSIONS
  // in @opuspopuli/common: this value only decides the width pgvector.provider
  // uses when it CREATES its table, and `CREATE TABLE IF NOT EXISTS` will not
  // widen one that already exists — so a disagreement surfaces as a runtime
  // insert failure, not a startup error. The migration drops and recreates
  // that table for exactly this reason.
  dimensions: Number.parseInt(process.env.VECTORDB_DIMENSIONS || "768", 10),
}));

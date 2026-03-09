import { registerAs } from "@nestjs/config";

/**
 * Vector Database Configuration
 *
 * Maps VECTORDB_* environment variables to nested config.
 */
export const vectordbConfig = registerAs("vectordb", () => ({
  dimensions: Number.parseInt(process.env.VECTORDB_DIMENSIONS || "384", 10),
}));

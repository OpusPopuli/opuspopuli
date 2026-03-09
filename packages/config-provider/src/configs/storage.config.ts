import { registerAs } from "@nestjs/config";

/**
 * Storage Configuration
 *
 * Maps STORAGE_* environment variables to nested config.
 */
export const storageConfig = registerAs("storage", () => ({
  provider: process.env.STORAGE_PROVIDER || "supabase",
}));

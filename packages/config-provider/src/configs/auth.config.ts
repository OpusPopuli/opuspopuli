import { registerAs } from "@nestjs/config";

/**
 * Auth Configuration
 *
 * Maps AUTH_* environment variables to nested config.
 */
export const authConfig = registerAs("auth", () => ({
  provider: process.env.AUTH_PROVIDER || "supabase",
}));

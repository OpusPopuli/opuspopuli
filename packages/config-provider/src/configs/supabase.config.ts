import { registerAs } from "@nestjs/config";

/**
 * Supabase Configuration
 *
 * Maps SUPABASE_* environment variables to nested config for providers.
 * Used by auth-provider, storage-provider, and secrets-provider.
 */
export const supabaseConfig = registerAs("supabase", () => ({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}));

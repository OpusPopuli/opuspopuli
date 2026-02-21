import { registerAs } from '@nestjs/config';

/**
 * Secrets Configuration
 *
 * Maps SECRETS_* environment variables to nested config.
 *
 * Provider options:
 * - 'env' (default): Read from process.env (works everywhere)
 * - 'supabase': Supabase Vault
 */
export default registerAs('secrets', () => ({
  provider: process.env.SECRETS_PROVIDER || 'env',
}));

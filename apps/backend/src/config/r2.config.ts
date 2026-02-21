import { registerAs } from '@nestjs/config';

/**
 * Cloudflare R2 Configuration
 *
 * Maps R2_* environment variables to nested config.
 * Used when STORAGE_PROVIDER=r2.
 */
export default registerAs('r2', () => ({
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || 'documents',
}));

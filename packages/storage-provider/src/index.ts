/**
 * @opuspopuli/storage-provider
 *
 * Storage provider implementations for the Opus Populi platform.
 * Provides pluggable file storage with Supabase Storage and Cloudflare R2.
 */

// Re-export types from common
export {
  IStorageProvider,
  IStorageConfig,
  IStorageFile,
  IListFilesResult,
  ISignedUrlOptions,
  StorageError,
} from "@opuspopuli/common";

// Providers
export { SupabaseStorageProvider } from "./providers/supabase.provider.js";
export { R2StorageProvider } from "./providers/r2.provider.js";

// Module
export { StorageModule } from "./storage.module.js";

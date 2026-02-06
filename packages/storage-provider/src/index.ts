/**
 * @opuspopuli/storage-provider
 *
 * Storage provider implementations for the Opus Populi platform.
 * Provides pluggable file storage with Supabase Storage.
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

// Module
export { StorageModule } from "./storage.module.js";

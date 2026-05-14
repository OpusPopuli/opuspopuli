/**
 * Shared storage provider utilities
 *
 * Common error-mapping helpers used by both SupabaseStorageProvider
 * and R2StorageProvider so the identical catch blocks live in one place.
 */

import { Logger } from "@nestjs/common";
import { StorageError } from "@opuspopuli/common";

/**
 * Wraps a storage operation and maps errors to StorageError with a
 * consistent error code and log line.
 */
export async function withStorageError<T>(
  logger: Logger,
  logMessage: string,
  errorCode: string,
  errorMessage: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`${logMessage}: ${(error as Error).message}`);
    throw new StorageError(errorMessage, errorCode, error as Error);
  }
}

/**
 * Convenience wrapper specifically for getSignedUrl implementations.
 * Both SupabaseStorageProvider and R2StorageProvider use identical
 * error-wrapping arguments for this operation.
 */
export function withSignedUrlError<T>(
  logger: Logger,
  bucket: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withStorageError(
    logger,
    "Error getting signed URL",
    "SIGNED_URL_ERROR",
    `Failed to get signed URL for ${bucket}/${key}`,
    fn,
  );
}

/**
 * Convenience wrapper specifically for deleteFile implementations.
 */
export function withDeleteError<T>(
  logger: Logger,
  bucket: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withStorageError(
    logger,
    "Error deleting file",
    "DELETE_ERROR",
    `Failed to delete ${bucket}/${key}`,
    fn,
  );
}

/**
 * Convenience wrapper specifically for listFiles implementations.
 */
export function withListError<T>(
  logger: Logger,
  bucket: string,
  prefix: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withStorageError(
    logger,
    "Error listing files",
    "LIST_ERROR",
    `Failed to list files in ${bucket}/${prefix}`,
    fn,
  );
}

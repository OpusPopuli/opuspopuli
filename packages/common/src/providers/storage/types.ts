/**
 * Storage Provider Types
 *
 * Interfaces for file storage operations (Supabase Storage, Cloudflare R2, etc.)
 */

/**
 * File listing result
 */
export interface IStorageFile {
  key: string;
  size?: number;
  lastModified?: Date;
  etag?: string;
}

/**
 * List files result
 */
export interface IListFilesResult {
  files: IStorageFile[];
  continuationToken?: string;
  isTruncated?: boolean;
}

/**
 * Signed URL options
 */
export interface ISignedUrlOptions {
  expiresIn?: number; // seconds, default 3600
  contentType?: string;
}

/**
 * Storage provider interface
 */
export interface IStorageProvider {
  /**
   * Get provider name
   */
  getName(): string;

  /**
   * List files in a directory/prefix
   */
  listFiles(bucket: string, prefix: string): Promise<IListFilesResult>;

  /**
   * Get a signed URL for upload or download
   */
  getSignedUrl(
    bucket: string,
    key: string,
    upload: boolean,
    options?: ISignedUrlOptions,
  ): Promise<string>;

  /**
   * Delete a file
   */
  deleteFile(bucket: string, key: string): Promise<boolean>;

  /**
   * Check if a file exists
   */
  exists?(bucket: string, key: string): Promise<boolean>;

  /**
   * Get file metadata
   */
  getMetadata?(bucket: string, key: string): Promise<IStorageFile | null>;
}

/**
 * Storage provider configuration
 */
export interface IStorageConfig {
  region: string;
  bucket?: string;
  endpoint?: string;
}

/**
 * Storage error class
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

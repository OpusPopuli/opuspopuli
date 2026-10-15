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

/**
 * Options for a server-side streaming upload.
 *
 * `contentLength` is required, not optional: S3-compatible stores reject a
 * streamed PUT without a length unless it is uploaded as multipart, and the
 * callers for this method are archiving a file whose size they already know.
 */
export interface IPutStreamOptions {
  /** Exact byte length of the payload */
  contentLength: number;
  /** MIME type to store against the object */
  contentType?: string;
}

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
   * Upload a file from the server, streaming it.
   *
   * Every other write path here is a presigned URL, because the original
   * consumer was a browser uploading a scan photo. Server-side archival of a
   * bulk export (#1277) has no browser in the loop and the payload is ~1 GB,
   * so round-tripping it through a presigned URL would mean the server PUT-ing
   * a gigabyte to itself.
   *
   * `openStream` is a factory rather than a stream so an implementation that
   * needs to retry can obtain a fresh one — a consumed stream cannot be
   * rewound.
   *
   * Optional: a provider that cannot accept server-side uploads simply does
   * not implement it, and callers must treat its absence as a real outcome
   * rather than assuming success.
   */
  putStream?(
    bucket: string,
    key: string,
    openStream: () => NodeJS.ReadableStream,
    options: IPutStreamOptions,
  ): Promise<void>;

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

  /**
   * Create `bucket` if it does not already exist; resolve true when it is
   * usable afterwards (#1363).
   *
   * Exists because nothing in the stack could provision a bucket, so the
   * bulk-archive tier (#1277) silently retained nothing: the `bulk-archives`
   * bucket had never been created, every upload was rejected, and each
   * snapshot row landed with `storage_key` NULL — recorded as having no
   * payload. The retention guarantee was not in force in any environment.
   *
   * Must be IDEMPOTENT: callers invoke it before an upload without knowing
   * whether a previous run already created it, and "already exists" is a
   * success, not an error.
   *
   * `isPrivate` defaults to true and callers should leave it so unless they
   * mean otherwise. The archives hold raw public-record exports that include
   * contributor names and addresses; lawfully public is not the same as
   * world-readable from our object store.
   *
   * Optional: a provider with no concept of buckets, or no authority to
   * create them, does not implement it. Callers must treat its absence as
   * "cannot provision" and carry on rather than assuming success.
   */
  ensureBucket?(bucket: string, isPrivate?: boolean): Promise<boolean>;
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

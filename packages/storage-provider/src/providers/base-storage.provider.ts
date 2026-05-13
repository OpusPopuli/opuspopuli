/**
 * Abstract base class for storage providers.
 *
 * Provides the shared method signature boilerplate that jscpd detects as
 * a clone between R2StorageProvider and SupabaseStorageProvider. Both
 * providers implement the same interface via this base, which also holds
 * the logger and the typed `withSignedUrlError` / `withListError` /
 * `withDeleteError` convenience wrappers as protected methods.
 */

import { Logger } from "@nestjs/common";
import {
  IStorageProvider,
  IListFilesResult,
  IStorageFile,
  ISignedUrlOptions,
} from "@opuspopuli/common";
import {
  withSignedUrlError,
  withListError,
  withDeleteError,
  withStorageError,
} from "./storage-utils";

export abstract class BaseStorageProvider implements IStorageProvider {
  protected abstract readonly logger: Logger;

  abstract getName(): string;

  async listFiles(bucket: string, prefix: string): Promise<IListFilesResult> {
    return withListError(this.logger, bucket, prefix, () =>
      this.listFilesImpl(bucket, prefix),
    );
  }

  async getSignedUrl(
    bucket: string,
    key: string,
    upload: boolean,
    options: ISignedUrlOptions = {},
  ): Promise<string> {
    return withSignedUrlError(this.logger, bucket, key, () =>
      this.getSignedUrlImpl(bucket, key, upload, options),
    );
  }

  async deleteFile(bucket: string, key: string): Promise<boolean> {
    return withDeleteError(this.logger, bucket, key, () =>
      this.deleteFileImpl(bucket, key),
    );
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    return withStorageError(
      this.logger,
      "Error checking file existence",
      "EXISTS_ERROR",
      `Failed to check existence of ${bucket}/${key}`,
      () => this.existsImpl(bucket, key),
    );
  }

  async getMetadata(bucket: string, key: string): Promise<IStorageFile | null> {
    return withStorageError(
      this.logger,
      "Error getting file metadata",
      "METADATA_ERROR",
      `Failed to get metadata for ${bucket}/${key}`,
      () => this.getMetadataImpl(bucket, key),
    );
  }

  protected abstract listFilesImpl(
    bucket: string,
    prefix: string,
  ): Promise<IListFilesResult>;

  protected abstract getSignedUrlImpl(
    bucket: string,
    key: string,
    upload: boolean,
    options: ISignedUrlOptions,
  ): Promise<string>;

  protected abstract deleteFileImpl(
    bucket: string,
    key: string,
  ): Promise<boolean>;

  protected abstract existsImpl(bucket: string, key: string): Promise<boolean>;

  protected abstract getMetadataImpl(
    bucket: string,
    key: string,
  ): Promise<IStorageFile | null>;
}

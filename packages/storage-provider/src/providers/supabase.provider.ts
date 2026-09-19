import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  IListFilesResult,
  IStorageFile,
  ISignedUrlOptions,
  StorageError,
  initSupabaseFromConfig,
  IPutStreamOptions,
} from "@opuspopuli/common";
import { BaseStorageProvider } from "./base-storage.provider";

/**
 * Supabase Storage Provider
 *
 * Implements file storage operations using Supabase Storage.
 * Used for local development and Supabase Cloud deployments.
 */
@Injectable()
export class SupabaseStorageProvider extends BaseStorageProvider {
  protected readonly logger = new Logger(SupabaseStorageProvider.name, {
    timestamp: true,
  });
  private readonly supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    super();
    try {
      const { supabase, url } = initSupabaseFromConfig(
        (key) => configService.get<string>(key),
        createClient,
      );
      this.supabase = supabase;
      this.logger.log(`SupabaseStorageProvider initialized for: ${url}`);
    } catch {
      throw new StorageError(
        "Supabase URL and key are required",
        "CONFIG_ERROR",
      );
    }
  }

  getName(): string {
    return "SupabaseStorageProvider";
  }

  protected async listFilesImpl(
    bucket: string,
    prefix: string,
  ): Promise<IListFilesResult> {
    // Normalize prefix - remove leading/trailing slashes for Supabase
    const normalizedPrefix = prefix.replace(/(^\/+)|(\/+$)/g, "");

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(normalizedPrefix, {
        limit: 1000,
        offset: 0,
      });

    if (error) {
      throw error;
    }

    const files: IStorageFile[] = (data || []).map((item) => ({
      key: normalizedPrefix ? `${normalizedPrefix}/${item.name}` : item.name,
      size: item.metadata?.size,
      lastModified: item.updated_at ? new Date(item.updated_at) : undefined,
      etag: item.metadata?.eTag,
    }));

    return {
      files,
      isTruncated: data ? data.length >= 1000 : false,
    };
  }

  protected async getSignedUrlImpl(
    bucket: string,
    key: string,
    upload: boolean,
    options: ISignedUrlOptions,
  ): Promise<string> {
    const expiresIn = options.expiresIn || 3600;

    if (upload) {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .createSignedUploadUrl(key);

      if (error) {
        throw error;
      }

      return data.signedUrl;
    } else {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .createSignedUrl(key, expiresIn);

      if (error) {
        throw error;
      }

      return data.signedUrl;
    }
  }

  protected async putStreamImpl(
    bucket: string,
    key: string,
    openStream: () => NodeJS.ReadableStream,
    options: IPutStreamOptions,
  ): Promise<void> {
    // Supabase Storage enforces a per-file upload limit — 50 MB by default,
    // raised per project. A ~1 GB bulk export (#1277) exceeds the default, and
    // the resulting error must surface rather than be swallowed: the caller
    // records the snapshot either way, and an upload that quietly did nothing
    // would leave a row claiming bytes that are not there.
    const { error } = await this.supabase.storage.from(bucket).upload(
      key,
      openStream() as unknown as ReadableStream,
      {
        duplex: "half",
        upsert: true,
        ...(options.contentType && { contentType: options.contentType }),
      } as never,
    );

    if (error) {
      throw error;
    }
  }

  protected async deleteFileImpl(
    bucket: string,
    key: string,
  ): Promise<boolean> {
    const { error } = await this.supabase.storage.from(bucket).remove([key]);

    if (error) {
      throw error;
    }

    this.logger.log(`Deleted file: ${bucket}/${key}`);
    return true;
  }

  /**
   * Parse a storage key into folder + fileName components and list the
   * matching entry via Supabase Storage. Shared by existsImpl() and getMetadataImpl()
   * to avoid duplicating the identical folder/list pattern.
   */
  private async listSingleFile(bucket: string, key: string) {
    const lastSlash = key.lastIndexOf("/");
    const folder = lastSlash > 0 ? key.substring(0, lastSlash) : "";
    const fileName = lastSlash > 0 ? key.substring(lastSlash + 1) : key;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(folder, { limit: 1, search: fileName });

    if (error) {
      throw error;
    }

    return { data, fileName };
  }

  protected async existsImpl(bucket: string, key: string): Promise<boolean> {
    const { data, fileName } = await this.listSingleFile(bucket, key);
    return data?.some((file) => file.name === fileName) || false;
  }

  protected async getMetadataImpl(
    bucket: string,
    key: string,
  ): Promise<IStorageFile | null> {
    const { data, fileName } = await this.listSingleFile(bucket, key);
    const file = data?.find((f) => f.name === fileName);

    if (!file) {
      return null;
    }

    return {
      key,
      size: file.metadata?.size,
      lastModified: file.updated_at ? new Date(file.updated_at) : undefined,
      etag: file.metadata?.eTag,
    };
  }
}

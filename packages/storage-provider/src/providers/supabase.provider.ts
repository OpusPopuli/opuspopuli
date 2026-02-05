import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  IStorageProvider,
  IListFilesResult,
  IStorageFile,
  ISignedUrlOptions,
  StorageError,
} from "@opuspopuli/common";

/**
 * Supabase Storage Provider
 *
 * Implements file storage operations using Supabase Storage.
 * Provides an OSS alternative to AWS S3.
 */
@Injectable()
export class SupabaseStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(SupabaseStorageProvider.name, {
    timestamp: true,
  });
  private readonly supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = configService.get<string>("supabase.url");
    const supabaseServiceKey = configService.get<string>(
      "supabase.serviceRoleKey",
    );
    const supabaseAnonKey = configService.get<string>("supabase.anonKey");

    if (!supabaseUrl || (!supabaseServiceKey && !supabaseAnonKey)) {
      throw new StorageError(
        "Supabase URL and key are required",
        "CONFIG_ERROR",
      );
    }

    // Use service role key for admin operations, fall back to anon key
    const key = supabaseServiceKey || supabaseAnonKey;

    this.supabase = createClient(supabaseUrl, key!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log(`SupabaseStorageProvider initialized for: ${supabaseUrl}`);
  }

  getName(): string {
    return "SupabaseStorageProvider";
  }

  async listFiles(bucket: string, prefix: string): Promise<IListFilesResult> {
    try {
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
    } catch (error) {
      this.logger.error(`Error listing files: ${(error as Error).message}`);
      throw new StorageError(
        `Failed to list files in ${bucket}/${prefix}`,
        "LIST_ERROR",
        error as Error,
      );
    }
  }

  async getSignedUrl(
    bucket: string,
    key: string,
    upload: boolean,
    options: ISignedUrlOptions = {},
  ): Promise<string> {
    try {
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
    } catch (error) {
      this.logger.error(
        `Error getting signed URL: ${(error as Error).message}`,
      );
      throw new StorageError(
        `Failed to get signed URL for ${bucket}/${key}`,
        "SIGNED_URL_ERROR",
        error as Error,
      );
    }
  }

  async deleteFile(bucket: string, key: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.storage.from(bucket).remove([key]);

      if (error) {
        throw error;
      }

      this.logger.log(`Deleted file: ${bucket}/${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting file: ${(error as Error).message}`);
      throw new StorageError(
        `Failed to delete ${bucket}/${key}`,
        "DELETE_ERROR",
        error as Error,
      );
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      // Parse the key to get folder and file name
      const lastSlash = key.lastIndexOf("/");
      const folder = lastSlash > 0 ? key.substring(0, lastSlash) : "";
      const fileName = lastSlash > 0 ? key.substring(lastSlash + 1) : key;

      const { data, error } = await this.supabase.storage
        .from(bucket)
        .list(folder, {
          limit: 1,
          search: fileName,
        });

      if (error) {
        throw error;
      }

      return data?.some((file) => file.name === fileName) || false;
    } catch (error) {
      this.logger.error(
        `Error checking file existence: ${(error as Error).message}`,
      );
      throw new StorageError(
        `Failed to check existence of ${bucket}/${key}`,
        "EXISTS_ERROR",
        error as Error,
      );
    }
  }

  async getMetadata(bucket: string, key: string): Promise<IStorageFile | null> {
    try {
      // Parse the key to get folder and file name
      const lastSlash = key.lastIndexOf("/");
      const folder = lastSlash > 0 ? key.substring(0, lastSlash) : "";
      const fileName = lastSlash > 0 ? key.substring(lastSlash + 1) : key;

      const { data, error } = await this.supabase.storage
        .from(bucket)
        .list(folder, {
          limit: 1,
          search: fileName,
        });

      if (error) {
        throw error;
      }

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
    } catch (error) {
      this.logger.error(
        `Error getting file metadata: ${(error as Error).message}`,
      );
      throw new StorageError(
        `Failed to get metadata for ${bucket}/${key}`,
        "METADATA_ERROR",
        error as Error,
      );
    }
  }
}

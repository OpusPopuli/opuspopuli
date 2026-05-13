import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  IListFilesResult,
  IStorageFile,
  ISignedUrlOptions,
  StorageError,
} from "@opuspopuli/common";
import { BaseStorageProvider } from "./base-storage.provider";

/**
 * Cloudflare R2 Storage Provider
 *
 * Implements file storage operations using Cloudflare R2.
 * R2 is S3-API compatible, so we use the AWS S3 SDK with a custom endpoint.
 * Used for production deployments.
 */
@Injectable()
export class R2StorageProvider extends BaseStorageProvider {
  protected readonly logger = new Logger(R2StorageProvider.name, {
    timestamp: true,
  });
  private readonly client: S3Client;

  constructor(private configService: ConfigService) {
    super();
    const accountId = configService.get<string>("r2.accountId");
    const accessKeyId = configService.get<string>("r2.accessKeyId");
    const secretAccessKey = configService.get<string>("r2.secretAccessKey");

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new StorageError(
        "R2 account ID, access key ID, and secret access key are required",
        "CONFIG_ERROR",
      );
    }

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.logger.log(
      `R2StorageProvider initialized for account: ${accountId.substring(0, 8)}...`,
    );
  }

  getName(): string {
    return "R2StorageProvider";
  }

  protected async listFilesImpl(
    bucket: string,
    prefix: string,
  ): Promise<IListFilesResult> {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
    });

    const response = await this.client.send(command);

    const files: IStorageFile[] = (response.Contents || []).map((item) => ({
      key: item.Key || "",
      size: item.Size,
      lastModified: item.LastModified,
      etag: item.ETag,
    }));

    return {
      files,
      continuationToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  }

  protected async getSignedUrlImpl(
    bucket: string,
    key: string,
    upload: boolean,
    options: ISignedUrlOptions,
  ): Promise<string> {
    const expiresIn = options.expiresIn || 3600;

    const command = upload
      ? new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(options.contentType && { ContentType: options.contentType }),
        })
      : new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  protected async deleteFileImpl(
    bucket: string,
    key: string,
  ): Promise<boolean> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.client.send(command);
    this.logger.log(`Deleted file: ${bucket}/${key}`);
    return true;
  }

  protected async existsImpl(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // HeadObject returns 404 NotFound if the object doesn't exist
      if ((error as { name?: string }).name === "NotFound") {
        return false;
      }
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

  protected async getMetadataImpl(
    bucket: string,
    key: string,
  ): Promise<IStorageFile | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await this.client.send(command);

      return {
        key,
        size: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
      };
    } catch (error) {
      // HeadObject returns 404 NotFound if the object doesn't exist
      if ((error as { name?: string }).name === "NotFound") {
        return null;
      }
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

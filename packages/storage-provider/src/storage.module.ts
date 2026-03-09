import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { IStorageProvider } from "@opuspopuli/common";
import {
  supabaseConfig,
  storageConfig,
  r2Config,
} from "@opuspopuli/config-provider";
import { SupabaseStorageProvider } from "./providers/supabase.provider.js";
import { R2StorageProvider } from "./providers/r2.provider.js";

/**
 * Storage Module
 *
 * Provides file storage capabilities using pluggable providers.
 *
 * Configure via STORAGE_PROVIDER environment variable:
 * - 'supabase' (default): Supabase Storage
 * - 'r2': Cloudflare R2
 */
@Global()
@Module({
  imports: [
    ConfigModule.forFeature(supabaseConfig),
    ConfigModule.forFeature(storageConfig),
    ConfigModule.forFeature(r2Config),
  ],
  providers: [
    {
      provide: "STORAGE_PROVIDER",
      useFactory: (configService: ConfigService): IStorageProvider => {
        const provider =
          configService.get<string>("storage.provider") || "supabase";

        switch (provider.toLowerCase()) {
          case "r2":
            return new R2StorageProvider(configService);
          case "supabase":
          default:
            return new SupabaseStorageProvider(configService);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ["STORAGE_PROVIDER"],
})
export class StorageModule {}

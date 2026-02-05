import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IStorageProvider } from "@opuspopuli/common";
import { SupabaseStorageProvider } from "./providers/supabase.provider.js";

/**
 * Storage Module
 *
 * Provides file storage capabilities using pluggable providers.
 * Requires ConfigModule.forRoot() to be called in the parent app module with isGlobal: true.
 *
 * Configure via STORAGE_PROVIDER environment variable:
 * - 'supabase' (default): Supabase Storage
 */
@Global()
@Module({
  providers: [
    {
      provide: "STORAGE_PROVIDER",
      useFactory: (configService: ConfigService): IStorageProvider => {
        const provider =
          configService.get<string>("storage.provider") || "supabase";

        switch (provider.toLowerCase()) {
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

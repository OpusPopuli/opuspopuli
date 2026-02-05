import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { IAuthProvider } from "@opuspopuli/common";
import { SupabaseAuthProvider } from "./providers/supabase.provider.js";

/**
 * Auth Module
 *
 * Provides authentication capabilities using pluggable providers.
 *
 * Configure via AUTH_PROVIDER environment variable:
 * - 'supabase' (default): Supabase Auth (GoTrue)
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: "AUTH_PROVIDER",
      useFactory: (configService: ConfigService): IAuthProvider => {
        const provider =
          configService.get<string>("auth.provider") || "supabase";

        switch (provider.toLowerCase()) {
          case "supabase":
          default:
            return new SupabaseAuthProvider(configService);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ["AUTH_PROVIDER"],
})
export class AuthModule {}

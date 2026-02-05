import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ISecretsProvider } from "@opuspopuli/common";
import { EnvProvider } from "./providers/env.provider.js";
import { AWSSecretsProvider } from "./providers/aws-secrets.provider.js";
import { SupabaseVaultProvider } from "./providers/supabase-vault.provider.js";

export const SECRETS_PROVIDER = "SECRETS_PROVIDER";

/**
 * Secrets Module
 *
 * Provides secrets management capabilities using pluggable providers.
 * Designed for starter kit flexibility - fork users choose their infrastructure.
 *
 * Configure via SECRETS_PROVIDER environment variable:
 * - 'env' (default): Read from process.env (works everywhere)
 * - 'aws': AWS Secrets Manager
 * - 'supabase': Supabase Vault
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SECRETS_PROVIDER,
      useFactory: (configService: ConfigService): ISecretsProvider => {
        const provider = configService.get<string>("secrets.provider") || "env";

        switch (provider.toLowerCase()) {
          case "aws":
            return new AWSSecretsProvider(configService);
          case "supabase":
            return new SupabaseVaultProvider(configService);
          case "env":
          default:
            return new EnvProvider();
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [SECRETS_PROVIDER],
})
export class SecretsModule {}

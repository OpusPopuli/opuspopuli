import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { IEmailProvider, IEmailConfig } from "@qckstrt/common";
import { ResendEmailProvider } from "./providers/resend.provider.js";

/**
 * Email Module
 *
 * Provides email sending capabilities using pluggable providers.
 *
 * Configure via environment variables:
 * - RESEND_API_KEY: Resend API key
 * - EMAIL_FROM_ADDRESS: Default from email address
 * - EMAIL_FROM_NAME: Default from name
 * - EMAIL_REPLY_TO: Optional reply-to address
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: "EMAIL_PROVIDER",
      useFactory: (configService: ConfigService): IEmailProvider => {
        const config: IEmailConfig = {
          apiKey: configService.get<string>("email.resendApiKey") || "",
          fromEmail:
            configService.get<string>("email.fromEmail") ||
            "noreply@example.com",
          fromName:
            configService.get<string>("email.fromName") || "Commonwealth Labs",
          replyToEmail: configService.get<string>("email.replyToEmail"),
        };

        return new ResendEmailProvider(config);
      },
      inject: [ConfigService],
    },
  ],
  exports: ["EMAIL_PROVIDER"],
})
export class EmailModule {}

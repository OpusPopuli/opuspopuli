import { registerAs } from "@nestjs/config";

/**
 * SMTP Configuration
 *
 * Maps SMTP_* environment variables to nested config.
 * Used by auth-provider for sending magic link emails directly
 * (bypassing GoTrue's signInWithOtp which forces PKCE flow).
 *
 * Local dev: Uses Inbucket (SMTP on port 2500, no auth)
 * Production: Uses Resend SMTP or any SMTP provider
 */
export const smtpConfig = registerAs("smtp", () => ({
  host: process.env.SMTP_HOST || "inbucket",
  port: Number.parseInt(process.env.SMTP_PORT || "2500", 10),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  fromEmail: process.env.SMTP_ADMIN_EMAIL || "noreply@opuspopuli.local",
  secure: (process.env.SMTP_PORT || "2500") === "465",
}));

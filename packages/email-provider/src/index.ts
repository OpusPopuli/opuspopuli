/**
 * @qckstrt/email-provider
 *
 * Email provider implementations for the QCKSTRT platform.
 * Provides pluggable email sending with Resend.
 */

// Re-export types from common
export {
  IEmailProvider,
  IEmailConfig,
  ISendEmailOptions,
  IEmailResult,
  EmailError,
} from "@qckstrt/common";

// Providers
export { ResendEmailProvider } from "./providers/resend.provider.js";

// Module
export { EmailModule } from "./email.module.js";

// Templates
export {
  welcomeEmailTemplate,
  type WelcomeTemplateData,
} from "./templates/welcome.template.js";
export {
  representativeContactTemplate,
  generateMailtoLink,
  type RepresentativeContactTemplateData,
} from "./templates/representative-contact.template.js";

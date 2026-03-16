/**
 * @opuspopuli/config-provider
 *
 * Shared configuration registrations for provider packages.
 *
 * Library modules use ConfigModule.forFeature() with these configs
 * to get both DI resolution of ConfigService AND access to the
 * namespaced config values.
 *
 * Example usage in a library module:
 *
 *   import { ConfigModule } from '@nestjs/config';
 *   import { supabaseConfig } from '@opuspopuli/config-provider';
 *
 *   @Module({
 *     imports: [ConfigModule.forFeature(supabaseConfig)],
 *     ...
 *   })
 */
export { supabaseConfig } from "./configs/supabase.config.js";
export { authConfig } from "./configs/auth.config.js";
export { storageConfig } from "./configs/storage.config.js";
export { secretsConfig } from "./configs/secrets.config.js";
export { emailConfig } from "./configs/email.config.js";
export { r2Config } from "./configs/r2.config.js";
export { ocrConfig } from "./configs/ocr.config.js";
export { llmConfig } from "./configs/llm.config.js";
export { embeddingsConfig } from "./configs/embeddings.config.js";
export { vectordbConfig } from "./configs/vectordb.config.js";
export { regionConfig } from "./configs/region.config.js";
export { smtpConfig } from "./configs/smtp.config.js";

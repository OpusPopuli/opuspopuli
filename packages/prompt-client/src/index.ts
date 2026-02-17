/**
 * @opuspopuli/prompt-client
 *
 * Database-backed prompt template client for AI-powered features.
 * Reads prompt templates from PostgreSQL and composes them with variables.
 *
 * @example
 * ```typescript
 * import { PromptClientModule, PromptClientService } from '@opuspopuli/prompt-client';
 *
 * // In your module
 * @Module({
 *   imports: [PromptClientModule],
 * })
 * export class AppModule {}
 *
 * // In your service
 * @Injectable()
 * export class MyService {
 *   constructor(private promptClient: PromptClientService) {}
 *
 *   async analyze(text: string) {
 *     const { promptText } = await this.promptClient.getDocumentAnalysisPrompt({
 *       documentType: 'generic',
 *       text,
 *     });
 *     // Use promptText with your LLM provider
 *   }
 * }
 * ```
 */

export { PromptClientService } from "./prompt-client.service.js";
export { PromptClientModule } from "./prompt-client.module.js";
export type { PromptClientModuleOptions } from "./prompt-client.module.js";
export type {
  PromptClientConfig,
  StructuralAnalysisParams,
  DocumentAnalysisParams,
  RAGParams,
  PromptServiceResponse,
} from "./types.js";
export { PROMPT_CLIENT_CONFIG } from "./types.js";

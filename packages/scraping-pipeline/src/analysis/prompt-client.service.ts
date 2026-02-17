/**
 * Prompt Client Service (re-export from shared package)
 *
 * Re-exports the shared PromptClientService from @opuspopuli/prompt-client.
 * The scraping pipeline now uses database-backed prompt templates.
 */

export {
  PromptClientService,
  type PromptClientConfig,
} from "@opuspopuli/prompt-client";

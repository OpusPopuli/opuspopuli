/**
 * Prompt Service Types
 *
 * Types for the AI prompt template system.
 */

/**
 * Response from the prompt client (DB-backed or remote AI Prompt Service).
 */
export interface PromptServiceResponse {
  /** The composed prompt text */
  promptText: string;
  /** Hash of the prompt template version */
  promptHash: string;
  /** Version identifier of the prompt template */
  promptVersion: string;
}

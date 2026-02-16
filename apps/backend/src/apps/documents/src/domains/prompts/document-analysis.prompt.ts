/**
 * Document Analysis Prompt Utilities
 *
 * Prompt templates have been moved to the database (prompt_templates table).
 * They are managed by @opuspopuli/prompt-client.
 *
 * This file retains only the response parsing utility.
 */

/**
 * Parse LLM response, stripping any markdown code blocks
 */
export function parseAnalysisResponse(
  response: string,
): Record<string, unknown> {
  // Strip markdown code blocks if present
  const cleaned = response
    .trim()
    .replace(/^```json\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '');

  return JSON.parse(cleaned);
}

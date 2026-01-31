import { DocumentType } from '@qckstrt/relationaldb-provider';

const BASE_INSTRUCTIONS = `Respond with valid JSON only. No markdown, no explanations.`;

const PROMPTS: Record<DocumentType, (text: string) => string> = {
  [DocumentType.generic]: (
    text,
  ) => `Analyze this document and extract key information.

DOCUMENT:
${text}

Respond with JSON:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["Key point 1", "Key point 2"],
  "entities": ["Person/org/place mentioned"]
}
${BASE_INSTRUCTIONS}`,

  [DocumentType.petition]: (
    text,
  ) => `You are a nonpartisan civic analyst. Analyze this petition.

PETITION:
${text}

Respond with JSON:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["Key point 1", "Key point 2"],
  "entities": ["Sponsors, officials, organizations mentioned"],
  "actualEffect": "What this would actually do if passed",
  "potentialConcerns": ["Concern 1", "Concern 2"],
  "beneficiaries": ["Who benefits"],
  "potentiallyHarmed": ["Who might be negatively affected"],
  "relatedMeasures": ["Related ballot measures or 'None identified'"]
}
${BASE_INSTRUCTIONS}`,

  [DocumentType.proposition]: (
    text,
  ) => `You are a nonpartisan civic analyst. Analyze this ballot proposition.

PROPOSITION:
${text}

Respond with JSON:
{
  "summary": "2-3 sentence summary of what this proposition does",
  "keyPoints": ["Key provision 1", "Key provision 2"],
  "entities": ["Sponsors, officials, organizations mentioned"],
  "actualEffect": "What this would actually change if passed",
  "potentialConcerns": ["Potential concern 1", "Potential concern 2"],
  "beneficiaries": ["Groups that would benefit"],
  "potentiallyHarmed": ["Groups that might be negatively affected"],
  "relatedMeasures": ["Related or conflicting measures"]
}
${BASE_INSTRUCTIONS}`,

  [DocumentType.contract]: (text) => `Analyze this contract document.

CONTRACT:
${text}

Respond with JSON:
{
  "summary": "Brief summary of the contract purpose",
  "keyPoints": ["Key term 1", "Key term 2"],
  "entities": ["Parties and stakeholders mentioned"],
  "parties": ["Party 1 name", "Party 2 name"],
  "obligations": ["Key obligation 1", "Key obligation 2"],
  "risks": ["Potential risk 1", "Potential risk 2"],
  "effectiveDate": "Contract effective date or 'Not specified'",
  "terminationClause": "Summary of termination terms or 'Not specified'"
}
${BASE_INSTRUCTIONS}`,

  [DocumentType.form]: (text) => `Analyze this form document.

FORM:
${text}

Respond with JSON:
{
  "summary": "What this form is for",
  "keyPoints": ["Important instruction 1", "Important instruction 2"],
  "entities": ["Issuing organization, departments mentioned"],
  "requiredFields": ["Required field 1", "Required field 2"],
  "purpose": "The purpose of this form",
  "submissionDeadline": "Any deadline mentioned or 'Not specified'"
}
${BASE_INSTRUCTIONS}`,
};

/**
 * Build an analysis prompt for the given document type
 */
export function buildAnalysisPrompt(
  text: string,
  documentType: DocumentType,
): string {
  const promptBuilder = PROMPTS[documentType] || PROMPTS[DocumentType.generic];
  return promptBuilder(text);
}

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

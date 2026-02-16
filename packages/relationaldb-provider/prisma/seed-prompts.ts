/**
 * Seed script for AI prompt templates.
 *
 * Upserts all prompt templates into the prompt_templates table.
 * Safe to run multiple times — uses name as unique key.
 *
 * Usage:
 *   pnpm --filter @opuspopuli/relationaldb-provider db:seed-prompts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PromptSeed {
  name: string;
  category: "structural_analysis" | "document_analysis" | "rag";
  description: string;
  templateText: string;
  variables: string[];
}

const prompts: PromptSeed[] = [
  // ============================================
  // STRUCTURAL ANALYSIS (scraping pipeline)
  // ============================================
  {
    name: "structural-analysis",
    category: "structural_analysis",
    description: "Base structural analysis template for web scraping",
    variables: [
      "DATA_TYPE",
      "CONTENT_GOAL",
      "HINTS_SECTION",
      "SCHEMA_DESCRIPTION",
      "HTML",
    ],
    templateText: `You are a web scraping expert. Analyze the following HTML and produce extraction rules as JSON.

## Task
Given the HTML from a web page, derive CSS selectors and extraction rules to extract {{DATA_TYPE}} data.

## Content Goal
{{CONTENT_GOAL}}

{{HINTS_SECTION}}

## Target Schema
The extracted data must conform to this structure:
{{SCHEMA_DESCRIPTION}}

## Required Output Format
Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "containerSelector": "CSS selector for the element containing all items",
  "itemSelector": "CSS selector for each individual item (relative to container)",
  "fieldMappings": [
    {
      "fieldName": "the target field name",
      "selector": "CSS selector relative to the item",
      "extractionMethod": "text|attribute|html|regex",
      "attribute": "only if extractionMethod is 'attribute'",
      "regexPattern": "only if extractionMethod is 'regex'",
      "regexGroup": 1,
      "transform": { "type": "transform_type", "params": {} },
      "required": true,
      "defaultValue": "fallback if empty"
    }
  ],
  "pagination": { "type": "none", "maxPages": 1 },
  "preprocessing": [],
  "analysisNotes": "Brief notes about the page structure"
}

## Rules
1. Use the MOST SPECIFIC CSS selectors available (prefer classes over tag names)
2. Field selectors are RELATIVE to each item element
3. Required fields MUST have selectors that match elements in the HTML
4. Use "regex" extractionMethod when text needs pattern extraction
5. Use transforms for date parsing, name formatting, URL resolution
6. If the page has multiple formats (e.g., table AND heading-based), choose the PRIMARY format
7. The containerSelector should match exactly ONE element
8. The itemSelector should match MULTIPLE elements within the container

## HTML to Analyze
\`\`\`html
{{HTML}}
\`\`\``,
  },

  {
    name: "structural-schema-propositions",
    category: "structural_analysis",
    description: "Schema description for proposition/ballot measure data",
    variables: [],
    templateText: `Each proposition/ballot measure has:
- externalId (required): Unique measure identifier (e.g., "ACA-13", "SB-42", "PROP-36")
- title (required): Measure title or description
- summary (optional): Longer summary or full description text
- status (optional): Current status (default: "pending")
- electionDate (optional): Date of the election (use date_parse transform)
- sourceUrl (optional): URL to source document or PDF`,
  },

  {
    name: "structural-schema-meetings",
    category: "structural_analysis",
    description: "Schema description for meeting/hearing data",
    variables: [],
    templateText: `Each meeting/hearing has:
- externalId (required): Unique meeting identifier
- title (required): Committee name or meeting title
- body (optional): Legislative body (e.g., "Assembly", "Senate")
- scheduledAt (required): Date and time of the meeting (use date_parse transform)
- location (optional): Physical location
- agendaUrl (optional): URL to the meeting agenda`,
  },

  {
    name: "structural-schema-representatives",
    category: "structural_analysis",
    description: "Schema description for representative/legislator data",
    variables: [],
    templateText: `Each representative/legislator has:
- externalId (required): Unique identifier (e.g., "ca-assembly-30")
- name (required): Full name of the representative (use name_format transform if "Last, First")
- chamber (optional): Legislative chamber (e.g., "Assembly", "Senate")
- district (required): District identifier (e.g., "District 30")
- party (required): Political party (Democratic, Republican, Independent)
- photoUrl (optional): URL to profile photo (attribute extraction on img src)
- contactInfo.website (optional): Profile page URL (attribute extraction on anchor href)`,
  },

  {
    name: "structural-schema-default",
    category: "structural_analysis",
    description: "Default schema description for unknown data types",
    variables: [],
    templateText: `Extract all relevant structured data fields from each item.`,
  },

  // ============================================
  // DOCUMENT ANALYSIS (documents service)
  // ============================================
  {
    name: "document-analysis-base-instructions",
    category: "document_analysis",
    description:
      "Shared base instructions appended to all document analysis prompts",
    variables: [],
    templateText: `Respond with valid JSON only. No markdown, no explanations.`,
  },

  {
    name: "document-analysis-generic",
    category: "document_analysis",
    description: "Generic document analysis prompt",
    variables: ["TEXT"],
    templateText: `Analyze this document and extract key information.

DOCUMENT:
{{TEXT}}

Respond with JSON:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["Key point 1", "Key point 2"],
  "entities": ["Person/org/place mentioned"]
}`,
  },

  {
    name: "document-analysis-petition",
    category: "document_analysis",
    description: "Petition document analysis prompt",
    variables: ["TEXT"],
    templateText: `You are a nonpartisan civic analyst. Analyze this petition.

PETITION:
{{TEXT}}

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
}`,
  },

  {
    name: "document-analysis-proposition",
    category: "document_analysis",
    description: "Ballot proposition analysis prompt",
    variables: ["TEXT"],
    templateText: `You are a nonpartisan civic analyst. Analyze this ballot proposition.

PROPOSITION:
{{TEXT}}

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
}`,
  },

  {
    name: "document-analysis-contract",
    category: "document_analysis",
    description: "Contract document analysis prompt",
    variables: ["TEXT"],
    templateText: `Analyze this contract document.

CONTRACT:
{{TEXT}}

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
}`,
  },

  {
    name: "document-analysis-form",
    category: "document_analysis",
    description: "Form document analysis prompt",
    variables: ["TEXT"],
    templateText: `Analyze this form document.

FORM:
{{TEXT}}

Respond with JSON:
{
  "summary": "What this form is for",
  "keyPoints": ["Important instruction 1", "Important instruction 2"],
  "entities": ["Issuing organization, departments mentioned"],
  "requiredFields": ["Required field 1", "Required field 2"],
  "purpose": "The purpose of this form",
  "submissionDeadline": "Any deadline mentioned or 'Not specified'"
}`,
  },

  // ============================================
  // RAG (knowledge service)
  // ============================================
  {
    name: "rag",
    category: "rag",
    description: "RAG answer generation prompt",
    variables: ["CONTEXT", "QUERY"],
    templateText: `You are a helpful assistant that answers questions based only on the provided context.

Instructions:
- Answer the question using ONLY information from the context below
- Be concise and direct - avoid unnecessary repetition
- If listing items, list each item exactly once
- If the context doesn't contain enough information, say so
- Do not make up information not present in the context

Context:
{{CONTEXT}}

Question: {{QUERY}}

Answer:`,
  },
];

async function main() {
  console.log("Seeding prompt templates...");

  for (const prompt of prompts) {
    await prisma.promptTemplate.upsert({
      where: { name: prompt.name },
      update: {
        category: prompt.category,
        description: prompt.description,
        templateText: prompt.templateText,
        variables: prompt.variables,
      },
      create: {
        name: prompt.name,
        category: prompt.category,
        description: prompt.description,
        templateText: prompt.templateText,
        variables: prompt.variables,
      },
    });
    console.log(`  ✓ ${prompt.name}`);
  }

  console.log(`\nSeeded ${prompts.length} prompt templates.`);
}

main()
  .catch((e) => {
    console.error("Failed to seed prompts:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

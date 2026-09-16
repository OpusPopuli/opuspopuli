/**
 * Resolve the analysis prompt, and prove it is the one we asked for.
 *
 * `getDocumentAnalysisPrompt({ documentType: 'proposition-analysis' })` looks
 * up `document-analysis-proposition-analysis` with `document-analysis-generic`
 * as its fallback — and `getTemplateFromDb` substitutes that fallback silently
 * when the requested template is missing. There is no warning.
 *
 * On this machine that substitution is not hypothetical. The local
 * `prompt_templates` table in `opuspopuli-db` carries
 * `document-analysis-proposition` (948 chars) but NOT
 * `document-analysis-proposition-analysis`. Run the generation eval with
 * `PROMPT_SERVICE_URL` unset and every number it produces describes
 * `document-analysis-generic` — 675 characters of instruction instead of the
 * 6,818-character analysis template — while the results JSON records a
 * `promptHash` that makes it look attributed.
 *
 * `getTemplate` has a second path to the same place: with a remote URL
 * configured but unreachable, it logs `warn` and falls through to the DB. An
 * eval that survives a prompt-service outage by quietly measuring a different
 * prompt is worse than one that fails.
 *
 * So this module does two things the client cannot do for itself:
 *
 *   1. requires `PROMPT_SERVICE_URL`, rather than accepting the DB path —
 *      the same deliberate no-fallback stance `getOcrTranscriptionPrompt`
 *      takes, and for the same reason (#1246, #1249);
 *   2. fetches the named template straight from prompt-service and checks its
 *      hash against the hash the client returned. `composeDocumentAnalysis`
 *      hashes `template.templateText`, so the two are directly comparable, and
 *      a mismatch means a fallback happened.
 *
 * The result is that a recorded score can name the instruction that produced
 * it and be right.
 */

import { DbService } from "@opuspopuli/relationaldb-provider";
import { PromptClientService } from "@opuspopuli/prompt-client";

export interface ResolvedPrompt {
  /** The template actually asked for, e.g. document-analysis-proposition-analysis. */
  templateName: string;
  /** The composed prompt — template WITH the document text substituted in. */
  promptText: string;
  /**
   * The template alone, as prompt-service published it.
   *
   * Kept because a scorer that needs to recognise the prompt in a model's
   * output must match against the template and not the composed prompt: the
   * composed prompt contains the document, so matching it would flag every
   * analysis that quoted the measure it was asked to analyse. See
   * `scoring/injection.ts`.
   */
  templateText: string;
  promptHash: string;
  promptVersion: string;
  templateChars: number;
}

export interface PromptServiceConfig {
  url: string;
  apiKey?: string;
  nodeId?: string;
}

export function readPromptServiceConfig(): PromptServiceConfig {
  const url = process.env.PROMPT_SERVICE_URL;
  if (!url) {
    throw new Error(
      "PROMPT_SERVICE_URL is not set.\n\n" +
        "Prompt text lives in the prompt-service repo, and this repo keeps no " +
        "inline copy. Without a reachable service the client falls back to the " +
        "local prompt_templates table, which does NOT carry " +
        "'document-analysis-proposition-analysis' — it would silently " +
        "substitute 'document-analysis-generic' and every score would describe " +
        "the wrong prompt.\n\n" +
        "  PROMPT_SERVICE_URL=http://localhost:3210 \\\n" +
        "  PROMPT_SERVICE_API_KEY=<key> \\\n" +
        "  pnpm --filter @opuspopuli/eval-harness eval:generation\n",
    );
  }
  return {
    url: url.replace(/\/$/, ""),
    apiKey: process.env.PROMPT_SERVICE_API_KEY,
    nodeId: process.env.PROMPT_SERVICE_NODE_ID,
  };
}

/**
 * The authoritative hash for a template, straight from prompt-service.
 *
 * Deliberately NOT routed through PromptClientService: this is the independent
 * check on that client's resolution, so sharing its fallback chain would make
 * the check agree with whatever the client did.
 */
async function fetchTemplate(
  cfg: PromptServiceConfig,
  templateName: string,
): Promise<{ promptHash: string; templateText: string }> {
  if (!cfg.apiKey) {
    throw new Error(
      "PROMPT_SERVICE_API_KEY is required to verify prompt attribution.",
    );
  }
  const path = `/prompts/${encodeURIComponent(templateName)}`;
  const response = await fetch(`${cfg.url}${path}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });

  if (response.status === 404) {
    throw new Error(
      `prompt-service has no template named "${templateName}". The eval cannot ` +
        "run against a prompt nobody published — seed prompt-service from its " +
        "repo (prisma/seed.ts) rather than pointing this at another template.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `prompt-service returned ${response.status} for ${path}. Refusing to ` +
        "continue: the DB fallback would substitute a different prompt.",
    );
  }

  const body = (await response.json()) as {
    promptHash: string;
    templateText: string;
  };
  return { promptHash: body.promptHash, templateText: body.templateText };
}

/**
 * The attribution check itself, separated from the fetching so it can be
 * tested: this comparison is the only thing standing between a run and a
 * results file that names a prompt it never used.
 */
export function assertAttribution(
  templateName: string,
  authoritativeHash: string,
  clientHash: string,
): void {
  if (clientHash === authoritativeHash) return;

  throw new Error(
    `Prompt attribution failed for "${templateName}".\n\n` +
      `  prompt-service says: ${authoritativeHash}\n` +
      `  the client returned: ${clientHash}\n\n` +
      "The client resolved a DIFFERENT template than the one requested — " +
      "almost certainly the 'document-analysis-generic' fallback, reached " +
      "because the remote fetch failed and getTemplateFromDb substituted it " +
      "without warning. Any score from this run would name the wrong prompt.",
  );
}

/**
 * Compose the proposition-analysis prompt for one measure and verify it came
 * from the template it claims.
 */
export async function resolveAnalysisPrompt(
  db: DbService,
  documentType: string,
  text: string,
): Promise<ResolvedPrompt> {
  const cfg = readPromptServiceConfig();
  const templateName = `document-analysis-${documentType}`;

  const authoritative = await fetchTemplate(cfg, templateName);

  const client = new PromptClientService(db, {
    promptServiceUrl: cfg.url,
    promptServiceApiKey: cfg.apiKey,
    hmacNodeId: cfg.nodeId,
  });
  const { promptText, promptHash, promptVersion } =
    await client.getDocumentAnalysisPrompt({ documentType, text });

  assertAttribution(templateName, authoritative.promptHash, promptHash);

  return {
    templateName,
    promptText,
    templateText: authoritative.templateText,
    promptHash,
    promptVersion,
    templateChars: authoritative.templateText.length,
  };
}

/**
 * JSON validity — did the model return a payload the pipeline can actually use?
 *
 * This deliberately reuses production's own salvage path
 * (`extractJsonObjectSlice` from `@opuspopuli/common`) rather than doing its
 * own parse. A model whose output the harness accepts but the pipeline rejects
 * — or vice versa — would produce a score describing neither.
 *
 * The distinction that matters is the one #1085 turns on, and it is the reason
 * `finishReason` is carried here at all: an output cut off at `maxTokens`
 * mid-object is an output-budget problem, while an output that finished and
 * was not JSON is a prompt problem. `extractJsonObjectSlice` needs balanced
 * braces, so a truncated payload comes back empty and is indistinguishable
 * from "the model wrote no JSON" unless the budget is taken into account.
 *
 * #1142's first run failed exactly here and produced entirely invalid results:
 * with reasoning left on, qwen3.5:9b spent its whole budget on hidden thinking
 * and returned an EMPTY response, scoring 0/3 on JSON while production
 * generated the same analyses fine. That reads as model incompatibility and is
 * one flag. `empty-response` is therefore its own verdict, never folded into
 * `no-json`.
 */

import { extractJsonObjectSlice } from "@opuspopuli/common";

export type JsonVerdict =
  | "valid"
  | "empty-response"
  | "truncated"
  | "no-json"
  | "parse-error";

export interface JsonValidityResult {
  verdict: JsonVerdict;
  valid: boolean;
  payload?: Record<string, unknown>;
  /** Present on parse-error, so a failure can be argued with. */
  detail?: string;
  responseChars: number;
}

export interface GenerationOutput {
  text: string;
  finishReason?: string;
  tokensOut?: number;
  maxTokens: number;
}

/**
 * Was the budget the reason this stopped?
 *
 * Mirrors proposition-analysis.service.ts: `finishReason` alone is not
 * trustworthy, because older Ollama builds omit `done_reason` and the provider
 * used to map it from `done`, which is true whenever generation finished for
 * ANY reason. Either signal is enough.
 */
export function looksTruncated(out: GenerationOutput): boolean {
  if (out.finishReason === "length") return true;
  const spent = out.tokensOut ?? 0;
  return spent > 0 && spent >= out.maxTokens * 0.98;
}

export function scoreJsonValidity(out: GenerationOutput): JsonValidityResult {
  const responseChars = out.text?.length ?? 0;
  const truncated = looksTruncated(out);

  // An empty response is its own diagnosis. Reported as `no-json` it looks
  // like the model cannot follow a format instruction, which sent the first
  // #1142 run to entirely wrong conclusions about two capable models.
  if (responseChars === 0) {
    return { verdict: "empty-response", valid: false, responseChars };
  }

  const candidate = extractJsonObjectSlice(out.text);
  if (!candidate) {
    return {
      verdict: truncated ? "truncated" : "no-json",
      valid: false,
      responseChars,
    };
  }

  try {
    const payload = JSON.parse(candidate) as Record<string, unknown>;
    return { verdict: "valid", valid: true, payload, responseChars };
  } catch (error) {
    return {
      verdict: truncated ? "truncated" : "parse-error",
      valid: false,
      detail: (error as Error).message,
      responseChars,
    };
  }
}

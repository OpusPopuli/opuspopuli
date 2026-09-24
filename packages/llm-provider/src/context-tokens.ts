/**
 * Parse a configured context window.
 *
 * ## Why this is a function, and why it lives here
 *
 * `llm.module.ts` is coverage-excluded (CLAUDE.md), so logic written inline
 * there cannot be tested. The failure modes below are all silent, and silent
 * failures are exactly what must not go untested — so the parsing lives in this
 * file and the env-var *chain* lives in `llm.config.ts` beside the url/model
 * chains it has to stay consistent with.
 *
 * ## What it rejects, and why rejecting is not enough
 *
 * `Number.parseInt` is lenient in the one direction that hurts here:
 * `parseInt("128k", 10)` is `128`, which is a positive finite number and would
 * sail through any `> 0` guard. Every call would then read 128 tokens of the
 * document and answer fluently about them — the exact failure this setting
 * exists to prevent, caused by the setting itself.
 *
 * So a value must be entirely digits, and at least {@link MIN_CONTEXT_TOKENS}.
 * Both rejections WARN rather than pass silently: the repo convention for a bad
 * config value (see `LOG_LEVEL` in CLAUDE.md) is to fall back to the default
 * and say so at startup. Falling back here means sending no `num_ctx`, which on
 * the deployed GGUF build means reading 15% of a long bill — so a warning is
 * the difference between a visible misconfiguration and a mystery about model
 * quality.
 */

/**
 * Below this, a window is a typo rather than a choice.
 *
 * Chosen to catch the suffix class — `128k` → 128, `32k` → 32 — which is the
 * mistake a human actually makes when the unit is tokens. No real deployment
 * runs a sub-1024 window: the civics prompts alone are 6.6K tokens.
 */
export const MIN_CONTEXT_TOKENS = 1024;

/** Digits only. See the note above on `parseInt("128k")`. */
const DIGITS = /^\d+$/;

export interface ContextTokensWarning {
  value: string;
  reason: "not-a-number" | "below-minimum";
}

export interface ContextTokensResult {
  /** Undefined means "send no `num_ctx`" — the build applies its own default. */
  contextTokens?: number;
  warning?: ContextTokensWarning;
}

/**
 * @param raw - The resolved config value, already through its fallback chain.
 *   An empty, whitespace-only or absent value is "unset", not an error: it is
 *   the correct setting for a build that reads long prompts by default.
 */
export function resolveContextTokens(raw?: string | null): ContextTokensResult {
  const value = raw?.trim();
  if (!value) return {};

  if (!DIGITS.test(value)) {
    return { warning: { value, reason: "not-a-number" } };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_CONTEXT_TOKENS) {
    return { warning: { value, reason: "below-minimum" } };
  }

  return { contextTokens: parsed };
}

/** The warning text, kept beside the rule so the two cannot drift. */
export function contextTokensWarning(w: ContextTokensWarning): string {
  const tail =
    w.reason === "not-a-number"
      ? "is not a whole number of tokens"
      : `is below the ${MIN_CONTEXT_TOKENS} minimum`;
  return (
    `Ignoring context window "${w.value}": it ${tail}. No num_ctx will be ` +
    "sent, so the model applies its build default — which on a GGUF build " +
    "silently truncates long prompts. Set a plain token count, e.g. 131072."
  );
}

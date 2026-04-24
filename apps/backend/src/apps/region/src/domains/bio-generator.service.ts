import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type {
  BioClaim,
  ILLMProvider,
  Representative,
} from '@opuspopuli/common';

/** Matches the opening `"bio": "` token in the LLM's JSON response. */
const BIO_FIELD_OPENER = /"bio"\s*:\s*"/;

/**
 * Maps the externalId region prefix to a human-readable state name.
 * Extend when a new state comes online. Federal reps use a different
 * prefix ("federal-" or similar); that case falls through to the
 * bare chamber label, and the prompt refuses to use training
 * knowledge if jurisdiction is ambiguous.
 */
const STATE_PREFIX_TO_NAME: Record<string, string> = {
  ca: 'California',
};
/** Strips leading ```json (or ```) markdown fences from an LLM response. */
const LEADING_CODE_FENCE = /^```(?:json)?\n?/;
/** Strips the trailing ``` fence. */
const TRAILING_CODE_FENCE = /\n?```$/;

/**
 * Generates AI bios for representatives that lack a scraped biography.
 *
 * Uses structured public record data (name, chamber, district, party,
 * committee assignments) to prompt the LLM for a factual biography.
 *
 * Tunable via env vars (useful for dev/prod balance):
 * - BIO_GENERATOR_MAX_TOKENS (default 800) — LLM output budget per bio
 * - BIO_GENERATOR_CONCURRENCY (default 1) — how many bios to generate in parallel
 * - BIO_GENERATOR_MAX_REPS (default unlimited) — cap on how many reps get a bio
 *   per run. Useful in dev to verify end-to-end plumbing quickly without
 *   waiting for a full-batch LLM run. Leave unset in production.
 *
 * Behavior:
 * - Only generates bios for representatives with empty/missing bio fields
 * - Existing scraped bios are never overwritten
 * - Soft failures: if generation fails, the rep is stored without a bio
 * - Sets bioSource='ai-generated' on successful generation
 */
@Injectable()
export class BioGeneratorService {
  private readonly logger = new Logger(BioGeneratorService.name);
  private readonly maxTokens: number;
  private readonly concurrency: number;
  private readonly maxReps?: number;

  constructor(
    @Optional()
    private readonly config?: ConfigService,
    @Optional()
    private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
  ) {
    this.maxTokens = this.readPositiveInt('BIO_GENERATOR_MAX_TOKENS', 800);
    this.concurrency = this.readPositiveInt('BIO_GENERATOR_CONCURRENCY', 1);
    this.maxReps = this.readOptionalPositiveInt('BIO_GENERATOR_MAX_REPS');
  }

  /**
   * Enrich a batch of representatives with AI-generated bios where missing.
   * Returns the same array with bios populated for those that lacked one.
   *
   * @param maxRepsOverride — per-call cap that takes precedence over the
   *   BIO_GENERATOR_MAX_REPS env default. Wired to the syncRegionData
   *   mutation's `maxReps` arg so operators can choose a cap per run
   *   without bouncing the service. Pass 0 or undefined to fall back
   *   to the env default.
   */
  async enrichBios(
    reps: Representative[],
    maxRepsOverride?: number,
  ): Promise<Representative[]> {
    if (!this.promptClient || !this.llm) {
      return reps;
    }

    const cap =
      maxRepsOverride && maxRepsOverride > 0 ? maxRepsOverride : this.maxReps;
    const candidates = reps.filter((r) => !r.bio || r.bio.trim() === '');
    const needsBio = cap ? candidates.slice(0, cap) : candidates;

    if (needsBio.length > 0) {
      const capSource =
        maxRepsOverride && maxRepsOverride > 0 ? 'mutation arg' : 'env default';
      const capNote =
        cap && candidates.length > cap
          ? ` (capped from ${candidates.length} by ${capSource}=${cap})`
          : '';
      this.logger.log(
        `Generating AI bios for ${needsBio.length} representatives${capNote} (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
      );

      let succeeded = 0;
      for (let i = 0; i < needsBio.length; i += this.concurrency) {
        const batch = needsBio.slice(i, i + this.concurrency);
        const results = await Promise.all(
          batch.map((rep) => this.tryGenerateBio(rep)),
        );
        succeeded += results.filter(Boolean).length;
      }

      this.logger.log(
        `Generated ${succeeded}/${needsBio.length} AI bios successfully`,
      );
    }

    // Mark scraped bios that were present on arrival
    for (const rep of reps) {
      if (rep.bio && !rep.bioSource) {
        rep.bioSource = 'scraped';
      }
    }

    return reps;
  }

  /**
   * Generate a bio for one rep, mutating it in place on success.
   * Returns true if a bio was successfully generated and applied.
   * Swallows errors so one failed rep doesn't cancel its batch peers.
   */
  private async tryGenerateBio(rep: Representative): Promise<boolean> {
    try {
      const parsed = await this.generateBio(rep);
      if (parsed?.bio) {
        rep.bio = parsed.bio;
        rep.bioSource = 'ai-generated';
        // Persist the full claims array (#602). Undefined on tier-2
        // salvage since only the bio string survived parsing.
        rep.bioClaims = parsed.claims;
        return true;
      }
    } catch (error) {
      this.logger.warn(
        `Bio generation failed for ${rep.name}: ${(error as Error).message}`,
      );
    }
    return false;
  }

  /**
   * Generate a bio for a single representative via the prompt service + LLM.
   */
  private async generateBio(
    rep: Representative,
  ): Promise<BioResponse | undefined> {
    const structuredText = this.formatRepData(rep);

    const { promptText } = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'representative-bio',
      text: structuredText,
    });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    const parsed = this.parseBioFromResponse(result.text);
    if (parsed) {
      this.logClaimsSummary(rep, parsed);
    }
    return parsed;
  }

  private readPositiveInt(envKey: string, fallback: number): number {
    const raw = this.config?.get<string>(envKey);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readOptionalPositiveInt(envKey: string): number | undefined {
    const raw = this.config?.get<string>(envKey);
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  /**
   * Format representative data as key-value text for the prompt.
   * Deliberately omits committee assignments: the bio's sibling
   * "At a glance" summary covers those, and including committees in
   * the bio input causes the LLM to write about them regardless of
   * prompt instructions, bloats output, and correlates with JSON
   * truncation. See #594 Task 4.
   *
   * CRITICAL: jurisdiction (state) is plumbed explicitly. Without it,
   * the LLM disambiguates Name+Chamber+District by guessing a state
   * and hallucinates biographies of wrong-state namesakes. We derive
   * the jurisdiction from externalId (e.g., "ca-assembly-4" → California).
   */
  private formatRepData(rep: Representative): string {
    const jurisdiction = this.deriveJurisdiction(rep);
    return [
      `Name: ${rep.name}`,
      `Jurisdiction: ${jurisdiction}`,
      `District: ${rep.district}`,
      `Party: ${rep.party}`,
    ].join('\n');
  }

  /**
   * Derive a human-readable jurisdiction label from the rep's
   * externalId prefix + chamber. Gives the LLM enough context to
   * refuse or correctly identify a representative.
   */
  private deriveJurisdiction(rep: Representative): string {
    const prefix = rep.externalId.split('-')[0]?.toLowerCase() ?? '';
    const state = STATE_PREFIX_TO_NAME[prefix];
    if (!state) {
      // Federal or unknown — fall back to bare chamber so the prompt
      // can still decide whether to trust training knowledge.
      return rep.chamber;
    }
    return `${state} State ${rep.chamber}`;
  }

  /**
   * Parse the bio response from the LLM using a two-tier strategy so that
   * we get "something sane" even when the model emits malformed JSON or
   * truncated output.
   *
   * Tier 1 — full structured parse (ideal): extract { bio, wordCount,
   *   claims[] } from a balanced JSON block. Full claim-tagging preserved.
   *
   * Tier 2 — bio-only fallback: if JSON parse fails (truncation, rogue
   *   escapes, whatever), extract just the bio string directly. The bio
   *   is the only field we currently persist, so this salvages a usable
   *   bio whenever the model got that far before going sideways.
   *   Claims are logged-only today (#602) — don't let their fragility
   *   block bio persistence.
   *
   * Returns undefined only when neither tier finds a usable bio string.
   */
  private parseBioFromResponse(text: string): BioResponse | undefined {
    // Tier 1: full structured parse
    const candidate = this.extractJsonCandidate(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as {
          bio?: string;
          wordCount?: number;
          claims?: BioClaim[];
        };
        const bio = parsed.bio?.trim();
        if (bio && bio.length > 0) {
          return {
            bio,
            wordCount: parsed.wordCount,
            claims: Array.isArray(parsed.claims) ? parsed.claims : undefined,
            parseTier: 'full',
          };
        }
      } catch {
        // fall through to Tier 2
      }
    }

    // Tier 2: bio-only salvage
    const salvagedBio = this.extractBioString(text);
    if (salvagedBio && salvagedBio.length > 0) {
      this.logger.debug(
        `Bio parse tier-2 salvage: extracted ${salvagedBio.length}-char bio from ${text.length}-char response (JSON was malformed or truncated)`,
      );
      return { bio: salvagedBio, parseTier: 'bio-only' };
    }

    const head = text.slice(0, 80).replaceAll('\n', ' ');
    const tail = text.slice(-80).replaceAll('\n', ' ');
    this.logger.debug(
      `Bio parse failed entirely (both tiers): ${text.length}-char response. Head: "${head}..." Tail: "...${tail}"`,
    );
    return undefined;
  }

  /**
   * Extract the value of the "bio" field from raw LLM text using a careful
   * char-by-char scan that handles escape sequences. Works even when the
   * surrounding JSON is malformed or truncated — only requires that the
   * bio field itself was emitted with a closing quote.
   */
  private extractBioString(text: string): string | undefined {
    const match = BIO_FIELD_OPENER.exec(text);
    if (match?.index === undefined) return undefined;

    const start = match.index + match[0].length;
    let out = '';
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        // JSON escape sequences we care about
        switch (ch) {
          case 'n':
            out += '\n';
            break;
          case 't':
            out += '\t';
            break;
          case 'r':
            out += '\r';
            break;
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          default:
            out += ch;
        }
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        return out.trim();
      }
      out += ch;
    }
    // Hit end of text without closing quote — response was truncated
    // mid-bio. If we got a reasonable amount of text, return it anyway.
    return out.trim().length > 40 ? out.trim() : undefined;
  }

  /**
   * Pull a JSON object out of raw LLM text. Strips code fences, then
   * scans for the first balanced {...} block (handling nested objects
   * and strings with embedded braces). Handles prose before AND after.
   */
  private extractJsonCandidate(text: string): string | undefined {
    const trimmed = this.stripCodeFences(text.trim());
    const start = trimmed.indexOf('{');
    if (start < 0) return undefined;
    return this.sliceBalancedObject(trimmed, start);
  }

  private stripCodeFences(text: string): string {
    return text.startsWith('```')
      ? text.replace(LEADING_CODE_FENCE, '').replace(TRAILING_CODE_FENCE, '')
      : text;
  }

  /**
   * Walk `text` from `start` (which must be a `{`) and return the slice up
   * to and including its matching `}`, or undefined if the object never
   * closes. Correctly skips braces that appear inside JSON string values.
   */
  private sliceBalancedObject(text: string, start: number): string | undefined {
    const state = { depth: 0, inString: false, escaped: false };
    for (let i = start; i < text.length; i++) {
      if (this.advanceJsonState(state, text[i]) && state.depth === 0) {
        return text.slice(start, i + 1);
      }
    }
    return undefined;
  }

  /**
   * Advance a one-char JSON-parse state machine. Returns true iff the
   * character was a closing `}` (so the caller can check depth).
   */
  private advanceJsonState(state: JsonScanState, ch: string): boolean {
    if (state.escaped) {
      state.escaped = false;
      return false;
    }
    if (ch === '\\') {
      state.escaped = true;
      return false;
    }
    if (ch === '"') {
      state.inString = !state.inString;
      return false;
    }
    if (state.inString) return false;
    if (ch === '{') state.depth++;
    else if (ch === '}') {
      state.depth--;
      return true;
    }
    return false;
  }

  /**
   * Log claim-level attribution so we can audit source vs. training-origin
   * facts without yet persisting them. Storage + UI tracked in #602.
   */
  private logClaimsSummary(rep: Representative, parsed: BioResponse): void {
    if (parsed.parseTier === 'bio-only') {
      this.logger.debug(
        `Bio for ${rep.name}: tier-2 salvage (bio only, claims dropped)`,
      );
      return;
    }
    const claims = parsed.claims ?? [];
    if (claims.length === 0) {
      this.logger.debug(`Bio for ${rep.name}: no claims returned by LLM`);
      return;
    }
    const sourceCount = claims.filter((c) => c.origin === 'source').length;
    const trainingCount = claims.filter((c) => c.origin === 'training').length;
    this.logger.debug(
      `Bio for ${rep.name}: ${claims.length} claims (${sourceCount} source, ${trainingCount} training), ${parsed.wordCount ?? 'unknown'} words`,
    );
  }
}

interface JsonScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

interface BioResponse {
  bio: string;
  wordCount?: number;
  claims?: BioClaim[];
  parseTier: 'full' | 'bio-only';
}

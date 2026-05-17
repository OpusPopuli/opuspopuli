import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  type BioClaim,
  type Representative,
} from '@opuspopuli/common';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import { LlmGeneratorBase } from './llm-generator.base';

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
export class BioGeneratorService extends LlmGeneratorBase {
  private readonly logger = new Logger(BioGeneratorService.name);
  // Field initializers run after super(), so this.config is already set.
  private readonly maxTokens = readPositiveInt(
    this.config,
    'BIO_GENERATOR_MAX_TOKENS',
    800,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'BIO_GENERATOR_CONCURRENCY',
    1,
  );
  private readonly maxReps = readOptionalPositiveInt(
    this.config,
    'BIO_GENERATOR_MAX_REPS',
  );

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

    const candidates = reps.filter((r) => !r.bio || r.bio.trim() === '');
    const cap = this.resolveCap(maxRepsOverride);
    const needsBio = cap ? candidates.slice(0, cap) : candidates;

    if (needsBio.length > 0) {
      await this.runBatchGeneration(
        needsBio,
        candidates.length,
        cap,
        maxRepsOverride,
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
   * Pick the active cap: a positive mutation-arg override wins, else the
   * env default (possibly undefined → no cap).
   */
  private resolveCap(maxRepsOverride?: number): number | undefined {
    return maxRepsOverride && maxRepsOverride > 0
      ? maxRepsOverride
      : this.maxReps;
  }

  /**
   * Run the bounded-concurrency batch that turns a list of bio candidates
   * into generated bios. Mutates the reps in place and logs a summary.
   */
  private async runBatchGeneration(
    needsBio: Representative[],
    candidatesTotal: number,
    cap: number | undefined,
    maxRepsOverride: number | undefined,
  ): Promise<void> {
    const capSource =
      maxRepsOverride && maxRepsOverride > 0 ? 'mutation arg' : 'env default';
    const capNote =
      cap && candidatesTotal > cap
        ? ` (capped from ${candidatesTotal} by ${capSource}=${cap})`
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
    const prefix = rep.externalId?.split('-')[0]?.toLowerCase() ?? '';
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
    const candidate = extractJsonObjectSlice(text);
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
    const salvagedBio = extractFieldString(text, 'bio');
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

interface BioResponse {
  bio: string;
  wordCount?: number;
  claims?: BioClaim[];
  parseTier: 'full' | 'bio-only';
}

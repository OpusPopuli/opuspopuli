import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider, Representative } from '@opuspopuli/common';

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
   */
  async enrichBios(reps: Representative[]): Promise<Representative[]> {
    if (!this.promptClient || !this.llm) {
      return reps;
    }

    const candidates = reps.filter((r) => !r.bio || r.bio.trim() === '');
    const needsBio = this.maxReps
      ? candidates.slice(0, this.maxReps)
      : candidates;

    if (needsBio.length > 0) {
      const capNote =
        this.maxReps && candidates.length > this.maxReps
          ? ` (capped from ${candidates.length} by BIO_GENERATOR_MAX_REPS=${this.maxReps})`
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
      const bio = await this.generateBio(rep);
      if (bio) {
        rep.bio = bio;
        rep.bioSource = 'ai-generated';
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
  private async generateBio(rep: Representative): Promise<string | undefined> {
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
    return parsed?.bio;
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
   */
  private formatRepData(rep: Representative): string {
    const lines = [
      `Name: ${rep.name}`,
      `Chamber: ${rep.chamber}`,
      `District: ${rep.district}`,
      `Party: ${rep.party}`,
    ];

    if (rep.committees && rep.committees.length > 0) {
      const committeeLines = rep.committees
        .map((c) => `  - ${c.role ? `${c.role}: ` : ''}${c.name}`)
        .join('\n');
      lines.push(`Committee Assignments:\n${committeeLines}`);
    }

    return lines.join('\n');
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

    const head = text.slice(0, 80).replace(/\n/g, ' ');
    const tail = text.slice(-80).replace(/\n/g, ' ');
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
    const match = text.match(/"bio"\s*:\s*"/);
    if (!match || match.index === undefined) return undefined;

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
    let trimmed = text.trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const start = trimmed.indexOf('{');
    if (start < 0) return undefined;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return trimmed.slice(start, i + 1);
      }
    }
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

interface BioClaim {
  sentence: string;
  origin: 'source' | 'training';
  sourceField?: string | null;
  confidence?: 'high' | 'medium';
}

interface BioResponse {
  bio: string;
  wordCount?: number;
  claims?: BioClaim[];
  parseTier: 'full' | 'bio-only';
}

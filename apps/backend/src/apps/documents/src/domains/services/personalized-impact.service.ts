import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';

import {
  PersonalizedImpact,
  PersonalizedImpactInput,
} from '../dto/personalized-impact.dto';

/**
 * Generates the "What this means to you" read that leads the scan results
 * (#1052): the measure's own AI analysis joined with the citizen's declared
 * signals, turned into a short plain-language impact statement by the LLM.
 *
 * Returns null when there is nothing to personalize — no analysis yet, an
 * empty summary, or no declared signals — so the frontend falls back to the
 * generic analysis (+ a sign-in nudge for anonymous users). Persistent
 * per-profile caching is added in subtask 3; today each call generates.
 */
@Injectable()
export class PersonalizedImpactService {
  private readonly logger = new Logger(PersonalizedImpactService.name);

  constructor(
    private readonly db: DbService,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
    private readonly promptClient: PromptClientService,
  ) {}

  async generate(
    userId: string,
    input: PersonalizedImpactInput,
  ): Promise<PersonalizedImpact | null> {
    // No declared signals => nothing to personalize against.
    if (input.interestTags.length === 0 && input.rankingFlags.length === 0) {
      return null;
    }

    const document = await this.db.document.findFirst({
      where: { id: input.documentId, userId },
    });
    if (!document || document.analysis == null) return null;

    const analysis = document.analysis as Record<string, unknown>;
    const summary =
      typeof analysis.summary === 'string' ? analysis.summary : '';
    if (!summary) return null;

    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : [];

    const { promptText, promptVersion } =
      await this.promptClient.getPersonalizedImpactPrompt({
        documentType: document.type,
        summary,
        actualEffect:
          typeof analysis.actualEffect === 'string'
            ? analysis.actualEffect
            : undefined,
        beneficiaries: asStringArray(analysis.beneficiaries),
        potentiallyHarmed: asStringArray(analysis.potentiallyHarmed),
        userInterestTags: input.interestTags,
        userRankingFlags: input.rankingFlags,
        userRegionLabel: input.regionLabel,
      });

    const result = await this.llm.generate(promptText, {
      maxTokens: 400,
      temperature: 0.3,
    });
    const text = result.text.trim();
    if (!text) return null;

    return {
      text,
      provider: this.llm.getName(),
      model: this.llm.getModelName(),
      promptVersion,
      fromCache: false,
    };
  }
}

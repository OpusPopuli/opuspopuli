/**
 * Entity Activity Summary Generator
 *
 * Generates 2-3 sentence AI summaries of a legislative entity's
 * (representative or committee) recent activity, suitable for the
 * top of the L3 layer on the rep / committee detail pages.
 *
 * Mirrors `bio-generator.service.ts` and
 * `committee-summary-generator.service.ts`:
 *   - DI: PromptClientService + ILLMProvider, both Optional.
 *   - Prompt name lives in the prompt-service repo
 *     (`representative-activity-summary` and
 *     `committee-activity-summary` documentTypes). The consumer
 *     here ships the structured input + persists the result; the
 *     authoritative prompt template stays out of this codebase per
 *     the IP boundary memory.
 *   - Output: structured JSON with a `summary` field; tier-1 strict
 *     parse, tier-2 salvage if the LLM truncates.
 *
 * Storage:
 *   `representatives.activity_summary` + `_generated_at` + `_window_days`
 *   `legislative_committees.activity_summary` + `_generated_at` + `_window_days`
 *
 * Issue #665.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  stableHash,
} from '@opuspopuli/common';
import { readPositiveInt } from './config-helpers';
import { AiOutputProvenance, LlmGeneratorBase } from './llm-generator.base';
import {
  outputCurrency,
  partitionStale,
  type GeneratedOutputOutcome,
  type LiveOutputKey,
  type StoredOutputKey,
  type OutputTarget,
} from './generated-output-key';

/** Bumped when what this generator stores changes shape. */
const ACTIVITY_SUMMARY_GENERATOR_VERSION = 'activity-summary-1';

/** The config axis of the skip key: everything that shapes what is stored. */
export function activitySummaryConfigHash(
  maxTokens: number,
  windowDays: number,
): string {
  return stableHash({
    generator: ACTIVITY_SUMMARY_GENERATOR_VERSION,
    maxTokens,
    windowDays,
    temperature: 0.2,
  });
}

export type ActivityEntityType = 'representative' | 'committee';

/** One stale summary, as the sync queues it. */
export interface ActivityTarget extends OutputTarget {
  entityType: ActivityEntityType;
}

const TEMPLATE: Record<ActivityEntityType, string> = {
  representative: 'representative-activity-summary',
  committee: 'committee-activity-summary',
};

/** The columns an entity's stored summary key is read from. */
const STORED_KEY_SELECT = {
  activitySummaryPromptHash: true,
  activitySummaryLlmDigest: true,
  activitySummarySourceHash: true,
  activitySummaryConfigHash: true,
} as const;

function storedKey(row: {
  activitySummaryPromptHash: string | null;
  activitySummaryLlmDigest: string | null;
  activitySummarySourceHash: string | null;
  activitySummaryConfigHash: string | null;
}): StoredOutputKey {
  return {
    promptHash: row.activitySummaryPromptHash,
    llmDigest: row.activitySummaryLlmDigest,
    sourceHash: row.activitySummarySourceHash,
    configHash: row.activitySummaryConfigHash,
  };
}

/** Structured shape we feed the prompt. */
interface ActivityBundle {
  entityName: string;
  entityType: 'representative' | 'committee';
  chamber: string;
  windowDays: number;
  counts: Record<string, number>;
  /** Up to 25 representative actions, newest first. */
  recentActions: Array<{
    date: string;
    actionType: string;
    rawSubject?: string;
    text?: string;
  }>;
}

interface SummaryResponse {
  summary: string;
}

@Injectable()
export class EntityActivitySummaryGeneratorService extends LlmGeneratorBase {
  private readonly logger = new Logger(
    EntityActivitySummaryGeneratorService.name,
  );
  // Field initializers run after super(), so this.config is already set.
  private readonly maxTokens = readPositiveInt(
    this.config,
    'ACTIVITY_SUMMARY_MAX_TOKENS',
    400,
  );
  private readonly windowDays = readPositiveInt(
    this.config,
    'ACTIVITY_SUMMARY_WINDOW_DAYS',
    90,
  );

  /**
   * Every entity with a `legislativeAction` in the window whose summary is
   * stale on some axis (K2: this used to regenerate all of them every run —
   * `activitySummaryGeneratedAt` was selected and never compared), and how
   * many are current. A legacy summary — the live prompt and weights, but no
   * input or config hash yet — is stamped and counted current (owner,
   * 2026-10-27).
   */
  async selectStale(
    windowDays: number = this.windowDays,
  ): Promise<{ pending: ActivityTarget[]; current: number }> {
    if (!this.db || !this.promptClient || !this.llm) {
      this.logger.warn(
        'Activity summary generator missing DB / promptClient / LLM — skipping',
      );
      return { pending: [], current: 0 };
    }
    const since = this.windowStart(windowDays);
    const where = {
      deletedAt: null,
      legislativeActions: { some: { date: { gte: since } } },
    };
    const select = {
      id: true,
      name: true,
      chamber: true,
      ...STORED_KEY_SELECT,
    };
    const [reps, committees] = await Promise.all([
      this.db.representative.findMany({ where, select }),
      this.db.legislativeCommittee.findMany({ where, select }),
    ]);
    const candidates = [
      ...reps.map((r) => ({ ...r, entityType: 'representative' as const })),
      ...committees.map((c) => ({ ...c, entityType: 'committee' as const })),
    ];

    return partitionStale(candidates, {
      assess: (entity) => this.assess(entity, storedKey(entity), windowDays),
      stamp: (entity, live) => this.stamp(entity.entityType, entity.id, live),
      target: (entity, key) => ({
        entityType: entity.entityType,
        id: entity.id,
        key,
      }),
    });
  }

  /**
   * One entity's summary — the `activity-summary` job (S4). Re-checks
   * currency first: a summary made current since it was selected is left
   * alone. A transient LLM failure throws, so the queue retries it.
   */
  async generateOne(
    entityType: ActivityEntityType,
    id: string,
    windowDays: number = this.windowDays,
  ): Promise<GeneratedOutputOutcome> {
    if (!this.db || !this.promptClient || !this.llm) return 'skipped';
    const select = {
      id: true,
      name: true,
      chamber: true,
      activitySummary: true,
      ...STORED_KEY_SELECT,
    };
    const entity =
      entityType === 'representative'
        ? await this.db.representative.findFirst({
            where: { id, deletedAt: null },
            select,
          })
        : await this.db.legislativeCommittee.findFirst({
            where: { id, deletedAt: null },
            select,
          });
    if (!entity) return 'skipped';
    const assessed = await this.assess(
      { ...entity, entityType },
      storedKey(entity),
      windowDays,
    );
    if (!assessed) return 'skipped';
    if (assessed.currency !== 'stale') {
      if (assessed.currency === 'legacy') {
        await this.stamp(entityType, id, assessed.live);
      }
      return 'unchanged';
    }

    const generated = await this.runPrompt(assessed.bundle);
    if (!generated) {
      this.logger.warn(
        `Activity summary for ${entityType} ${id}: the model returned no summary`,
      );
      return 'failed';
    }
    const data = {
      ...this.activitySummaryData(generated, windowDays),
      activitySummarySourceHash: assessed.live.sourceHash,
      activitySummaryConfigHash: assessed.live.configHash,
    };
    if (entityType === 'representative') {
      await this.db.representative.update({ where: { id }, data });
    } else {
      await this.db.legislativeCommittee.update({ where: { id }, data });
    }
    this.logger.log(
      `Updated activity summary for ${entityType} ${entity.name} (${id})`,
    );
    return entity.activitySummary ? 'updated' : 'created';
  }

  /**
   * Regenerate every stale summary in this process, one at a time — what the
   * admin script runs. The sync queues them instead.
   */
  async generateAll(overrideWindowDays?: number): Promise<{
    repsUpdated: number;
    committeesUpdated: number;
    skipped: number;
  }> {
    const windowDays = overrideWindowDays ?? this.windowDays;
    const { pending, current } = await this.selectStale(windowDays);
    let repsUpdated = 0;
    let committeesUpdated = 0;
    for (const target of pending) {
      try {
        const outcome = await this.generateOne(
          target.entityType,
          target.id,
          windowDays,
        );
        if (outcome !== 'created' && outcome !== 'updated') continue;
        if (target.entityType === 'representative') repsUpdated++;
        else committeesUpdated++;
      } catch (e) {
        this.logger.warn(
          `Activity summary failed for ${target.entityType} ${target.id}: ${(e as Error).message}`,
        );
      }
    }
    return { repsUpdated, committeesUpdated, skipped: current };
  }

  private windowStart(windowDays: number): Date {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    return since;
  }

  /**
   * The entity's bundle and how its stored summary compares with the live
   * key, or undefined when it has no action in the window (nothing to say).
   */
  private async assess(
    entity: {
      id: string;
      name: string;
      chamber: string;
      entityType: ActivityEntityType;
    },
    stored: StoredOutputKey,
    windowDays: number,
  ): Promise<
    | {
        bundle: ActivityBundle;
        live: LiveOutputKey;
        currency: ReturnType<typeof outputCurrency>;
      }
    | undefined
  > {
    const bundle = await this.buildBundle(
      entity.id,
      entity.entityType,
      entity.name,
      entity.chamber,
      windowDays,
    );
    if (bundle.recentActions.length === 0) return undefined;
    const live = await this.liveOutputKey(
      `document-analysis-${TEMPLATE[entity.entityType]}`,
      this.formatBundle(bundle),
      activitySummaryConfigHash(this.maxTokens, windowDays),
    );
    return { bundle, live, currency: outputCurrency(stored, live) };
  }

  /** Record a legacy summary's input and config as current (decision 2). */
  private async stamp(
    entityType: ActivityEntityType,
    id: string,
    live: LiveOutputKey,
  ): Promise<void> {
    const data = {
      activitySummarySourceHash: live.sourceHash,
      activitySummaryConfigHash: live.configHash,
    };
    if (entityType === 'representative') {
      await this.db!.representative.update({ where: { id }, data });
    } else {
      await this.db!.legislativeCommittee.update({ where: { id }, data });
    }
  }

  /**
   * Build the structured-input bundle for the prompt. Includes:
   *   - Entity identifying info (name + chamber)
   *   - Counts of each action_type in the window (drives the
   *     "did 7 hearings, moved 43 bills" sentence)
   *   - The 25 most recent action records — newest first — with
   *     enough detail (date + actionType + rawSubject + a 200-char
   *     text excerpt) for the LLM to ground its summary in
   *     specific bills/committees.
   */
  private async buildBundle(
    entityId: string,
    entityType: 'representative' | 'committee',
    entityName: string,
    chamber: string,
    windowDays: number,
  ): Promise<ActivityBundle> {
    if (!this.db) {
      throw new Error('DB unavailable');
    }
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const where =
      entityType === 'representative'
        ? { representativeId: entityId, date: { gte: since } }
        : { committeeId: entityId, date: { gte: since } };

    const [counts, recent] = await Promise.all([
      this.db.legislativeAction.groupBy({
        by: ['actionType'],
        where,
        _count: { _all: true },
      }),
      this.db.legislativeAction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 25,
        select: {
          date: true,
          actionType: true,
          rawSubject: true,
          text: true,
        },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const c of counts) countMap[c.actionType] = c._count._all;

    return {
      entityName,
      entityType,
      chamber,
      windowDays,
      counts: countMap,
      recentActions: recent.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        actionType: r.actionType,
        rawSubject: r.rawSubject ?? undefined,
        text: r.text ? r.text.slice(0, 200) : undefined,
      })),
    };
  }

  /**
   * The write payload both entity kinds share — one place so the
   * provenance triple (#1149) cannot drift between the rep and committee
   * paths, and so the CPD gate has nothing to find.
   */
  private activitySummaryData(
    generated: { summary: string; provenance: AiOutputProvenance },
    windowDays: number,
  ) {
    return {
      activitySummary: generated.summary,
      activitySummaryGeneratedAt: new Date(),
      activitySummaryWindowDays: windowDays,
      activitySummaryPromptHash: generated.provenance.promptHash,
      activitySummaryPromptVersion: generated.provenance.promptVersion,
      activitySummaryLlmModel: generated.provenance.llmModel,
      activitySummaryLlmDigest: generated.provenance.llmModelDigest,
    };
  }

  private async runPrompt(
    bundle: ActivityBundle,
  ): Promise<{ summary: string; provenance: AiOutputProvenance } | undefined> {
    if (!this.promptClient || !this.llm) return undefined;
    const documentType = TEMPLATE[bundle.entityType];

    const text = this.formatBundle(bundle);
    const prompt = await this.promptClient.getDocumentAnalysisPrompt({
      documentType,
      text,
    });
    const { promptText } = prompt;
    const result = await this.llm.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });
    const summary = this.parseSummary(result.text);
    if (!summary) return undefined;
    return { summary, provenance: await this.outputProvenance(prompt) };
  }

  /**
   * Render the bundle as structured key-value text for the prompt.
   * Layout matches the existing committee-summary-generator pattern
   * so the LLM sees a predictable shape regardless of entity type.
   */
  private formatBundle(bundle: ActivityBundle): string {
    const countLines = Object.entries(bundle.counts)
      .sort(([, a], [, b]) => b - a)
      .map(([type, n]) => `  - ${type}: ${n}`)
      .join('\n');
    const actionLines = bundle.recentActions
      .map((a, i) => {
        const subj = a.rawSubject ? ` ${a.rawSubject}` : '';
        const txt = a.text ? ` — ${a.text.replaceAll(/\s+/g, ' ').trim()}` : '';
        return `  ${i + 1}. [${a.date}] ${a.actionType}${subj}${txt}`;
      })
      .join('\n');

    return [
      `Entity: ${bundle.entityName} (${bundle.entityType})`,
      `Chamber: ${bundle.chamber}`,
      `Window: last ${bundle.windowDays} days`,
      `Action counts:\n${countLines || '  (none)'}`,
      `Recent actions (newest first):\n${actionLines || '  (none)'}`,
    ].join('\n');
  }

  /**
   * Two-tier parse mirroring committee-summary-generator. JSON
   * preferred; fall back to a regex slice if the LLM truncates.
   */
  private parseSummary(text: string): string | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as Partial<SummaryResponse>;
        if (
          typeof parsed.summary === 'string' &&
          parsed.summary.trim().length > 0
        ) {
          return parsed.summary.trim();
        }
      } catch {
        /* fall through to tier 2 */
      }
    }
    const sliced = extractFieldString(text, 'summary');
    if (sliced && sliced.trim().length > 0) return sliced.trim();
    return undefined;
  }
}

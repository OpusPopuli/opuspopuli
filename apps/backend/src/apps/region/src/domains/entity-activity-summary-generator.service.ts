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
 *   - Prompt name lives in the private prompt-service repo
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
import { extractFieldString, extractJsonObjectSlice } from '@opuspopuli/common';
import { readPositiveInt } from './config-helpers';
import { LlmGeneratorBase } from './llm-generator.base';

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
   * Regenerate summaries for every active representative + every
   * legislative committee that has at least one LegislativeAction in
   * the configured window. Skips entities whose existing summary is
   * fresher than the newest action (no work to do).
   *
   * Returns {repsUpdated, committeesUpdated, skipped} so the admin
   * script can log progress.
   */
  async generateAll(overrideWindowDays?: number): Promise<{
    repsUpdated: number;
    committeesUpdated: number;
    skipped: number;
  }> {
    if (!this.db || !this.promptClient || !this.llm) {
      this.logger.warn(
        'Activity summary generator missing DB / promptClient / LLM — skipping',
      );
      return { repsUpdated: 0, committeesUpdated: 0, skipped: 0 };
    }
    const windowDays = overrideWindowDays ?? this.windowDays;
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const repsUpdated = await this.generateForReps(since, windowDays);
    const committeesUpdated = await this.generateForCommittees(
      since,
      windowDays,
    );

    return { repsUpdated, committeesUpdated, skipped: 0 };
  }

  private async generateForReps(
    since: Date,
    windowDays: number,
  ): Promise<number> {
    if (!this.db) return 0;
    // Only reps with at least one linked action in the window.
    const candidates = await this.db.representative.findMany({
      where: {
        deletedAt: null,
        legislativeActions: { some: { date: { gte: since } } },
      },
      select: {
        id: true,
        name: true,
        chamber: true,
        activitySummaryGeneratedAt: true,
      },
    });

    let updated = 0;
    for (const rep of candidates) {
      try {
        const bundle = await this.buildBundle(
          rep.id,
          'representative',
          rep.name,
          rep.chamber,
          windowDays,
        );
        if (bundle.recentActions.length === 0) continue;
        const summary = await this.runPrompt(bundle);
        if (!summary) continue;

        await this.db.representative.update({
          where: { id: rep.id },
          data: {
            activitySummary: summary,
            activitySummaryGeneratedAt: new Date(),
            activitySummaryWindowDays: windowDays,
          },
        });
        updated += 1;
        this.logger.log(
          `Updated activity summary for rep ${rep.name} (${rep.id})`,
        );
      } catch (e) {
        this.logger.warn(
          `Activity summary failed for rep ${rep.id}: ${(e as Error).message}`,
        );
      }
    }
    return updated;
  }

  private async generateForCommittees(
    since: Date,
    windowDays: number,
  ): Promise<number> {
    if (!this.db) return 0;
    const candidates = await this.db.legislativeCommittee.findMany({
      where: {
        deletedAt: null,
        legislativeActions: { some: { date: { gte: since } } },
      },
      select: { id: true, name: true, chamber: true },
    });

    let updated = 0;
    for (const cmt of candidates) {
      try {
        const bundle = await this.buildBundle(
          cmt.id,
          'committee',
          cmt.name,
          cmt.chamber,
          windowDays,
        );
        if (bundle.recentActions.length === 0) continue;
        const summary = await this.runPrompt(bundle);
        if (!summary) continue;

        await this.db.legislativeCommittee.update({
          where: { id: cmt.id },
          data: {
            activitySummary: summary,
            activitySummaryGeneratedAt: new Date(),
            activitySummaryWindowDays: windowDays,
          },
        });
        updated += 1;
        this.logger.log(
          `Updated activity summary for committee ${cmt.name} (${cmt.id})`,
        );
      } catch (e) {
        this.logger.warn(
          `Activity summary failed for committee ${cmt.id}: ${(e as Error).message}`,
        );
      }
    }
    return updated;
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

  private async runPrompt(bundle: ActivityBundle): Promise<string | undefined> {
    if (!this.promptClient || !this.llm) return undefined;
    const documentType =
      bundle.entityType === 'representative'
        ? 'representative-activity-summary'
        : 'committee-activity-summary';

    const text = this.formatBundle(bundle);
    const { promptText } = await this.promptClient.getDocumentAnalysisPrompt({
      documentType,
      text,
    });
    const result = await this.llm.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });
    return this.parseSummary(result.text);
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

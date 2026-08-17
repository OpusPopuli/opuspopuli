import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { LlmRerankCommitteeCandidate } from '@opuspopuli/queue-provider';

/**
 * Defensive ceilings on the global candidate fetches. These are not
 * per-user scopes — see the note on `fetchCommitteeCandidates`.
 */
const PROPOSITION_CANDIDATE_FETCH_LIMIT = 50;
const REPRESENTATIVE_CANDIDATE_FETCH_LIMIT = 200;
const COMMITTEE_CANDIDATE_FETCH_LIMIT = 200;

/**
 * Resolves the candidate sets that proposition / representative / committee
 * reranks need supplied to them.
 *
 * Bills are the odd one out: `rerankForUser` resolves its own candidates
 * internally, so nothing has to hand them in. The other three entity types
 * take their candidates from the caller, which is why anything wanting to
 * rerank them has to resolve them first.
 *
 * Extracted from the scheduler because the manual trigger needs the same
 * sets. Previously only the nightly cron could resolve them, so
 * `triggerMyLlmRerank` could enqueue nothing but bills — a user asking to
 * "rerank my stuff" silently got a quarter of it, and the committees section
 * of their briefing stayed empty until 03:00.
 *
 * Lives in the worker rather than in the knowledge service on purpose:
 * `representative` and `legislativeCommittee` are region-owned tables, and
 * the knowledge service reaching into them directly would cross a bounded
 * context (see CLAUDE.md, Architecture rules).
 */
@Injectable()
export class RerankCandidatesService {
  private readonly logger = new Logger(RerankCandidatesService.name, {
    timestamp: true,
  });

  constructor(private readonly db: DbService) {}

  /**
   * Upcoming, live propositions only — a decided measure cannot be acted on,
   * so an explanation of why it matters to you would be wasted tokens.
   */
  async fetchPropositionCandidateIds(): Promise<string[]> {
    const rows = await this.db.proposition.findMany({
      where: {
        deletedAt: null,
        electionDate: { gte: new Date() },
        status: { in: ['active', 'pending'] },
      },
      select: { id: true },
      take: PROPOSITION_CANDIDATE_FETCH_LIMIT,
    });
    this.warnIfCapped(
      rows.length,
      PROPOSITION_CANDIDATE_FETCH_LIMIT,
      'PROPOSITION_CANDIDATE_FETCH_LIMIT',
    );
    return rows.map((r) => r.id);
  }

  /**
   * ALL non-deleted reps across every region — Assembly, Senate, county
   * boards of supervisors. The frontend's rep-slate resolution unions reps
   * from both the district query and the county-supervisors query, so
   * narrowing here would leave the briefing's cache lookup without a match.
   */
  async fetchRepresentativeCandidateIds(): Promise<string[]> {
    const rows = await this.db.representative.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: REPRESENTATIVE_CANDIDATE_FETCH_LIMIT,
    });
    this.warnIfCapped(
      rows.length,
      REPRESENTATIVE_CANDIDATE_FETCH_LIMIT,
      'REPRESENTATIVE_CANDIDATE_FETCH_LIMIT',
    );
    return rows.map((r) => r.id);
  }

  /**
   * Committees, with an EMPTY `membersOnUserSlate`.
   *
   * Privacy contract (prompt-service#81 / opuspopuli#836): the template treats
   * `membersOnUserSlate` as its strongest anchor — "your rep serves on it".
   * The per-user rep-slate intersect is not computed yet (opuspopuli#839), and
   * an empty list upholds the contract vacuously: no member anchor is
   * asserted, so the LLM falls back to topical / recent-activity / hearing
   * anchors. Committees with strong topic overlap still get useful
   * explanations; weak matches return skip.
   *
   * Passing anything OTHER than a genuine per-user intersect here would be a
   * privacy violation, not merely a quality regression — prompt-service cannot
   * validate the claim.
   */
  async fetchCommitteeCandidates(): Promise<LlmRerankCommitteeCandidate[]> {
    const rows = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: COMMITTEE_CANDIDATE_FETCH_LIMIT,
    });
    this.warnIfCapped(
      rows.length,
      COMMITTEE_CANDIDATE_FETCH_LIMIT,
      'COMMITTEE_CANDIDATE_FETCH_LIMIT',
    );
    return rows.map((r) => ({
      legislativeCommitteeId: r.id,
      membersOnUserSlate: [],
    }));
  }

  /**
   * Hitting the cap means the fetch is silently truncated, so the tail of the
   * table never gets explanations — invisible unless someone says so.
   */
  private warnIfCapped(count: number, limit: number, name: string): void {
    if (count === limit) {
      this.logger.warn(
        `Hit ${name} (${limit}) — raise the cap or scope per user.`,
      );
    }
  }
}

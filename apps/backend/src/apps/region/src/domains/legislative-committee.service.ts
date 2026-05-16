import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

/** Output shape for the list query. */
export interface LegislativeCommitteeListItem {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  url: string | null;
  description: string | null;
  memberCount: number;
}

export interface PaginatedLegislativeCommittees {
  items: LegislativeCommitteeListItem[];
  total: number;
  hasMore: boolean;
}

export interface LegislativeCommitteeMember {
  representativeId: string;
  name: string;
  role: string | null;
  party: string | null;
  photoUrl: string | null;
}

export interface LegislativeCommitteeHearing {
  id: string;
  title: string;
  scheduledAt: Date;
  agendaUrl: string | null;
}

export interface LegislativeCommitteeDetail {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  url: string | null;
  description: string | null;
  memberCount: number;
  members: LegislativeCommitteeMember[];
  hearings: LegislativeCommitteeHearing[];
  activitySummary: string | null;
  activitySummaryGeneratedAt: Date | null;
  activitySummaryWindowDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const HEARING_LIMIT = 10;
const HEARING_WINDOW_MONTHS = 12;
const ROLE_SORT_ORDER = ['Chair', 'Vice Chair', 'Member'];

/**
 * Read service for legislative committees. Backfilled by
 * LegislativeCommitteeBackfillService; this service exposes:
 *
 *   - paginated list with optional chamber filter
 *   - detail view with sorted members and best-effort recent hearings
 *
 * Hearings linkage is fuzzy: we substring-match the committee's
 * normalized name against `Meeting.title` within the same chamber, capped
 * at HEARING_WINDOW_MONTHS and HEARING_LIMIT. Phase 2 will introduce a
 * `Meeting.legislativeCommitteeId` FK populated by a dedicated linker.
 */
@Injectable()
export class LegislativeCommitteeService {
  private readonly logger = new Logger(LegislativeCommitteeService.name);

  constructor(@Optional() private readonly db?: DbService) {}

  /**
   * Paginated list. Sorted Chamber asc, Name asc so the UI renders a
   * stable Assembly-then-Senate breakdown.
   */
  async list(args: {
    skip: number;
    take: number;
    chamber?: string;
    /** Case-insensitive substring on `name`. Issue #672. */
    nameFilter?: string;
  }): Promise<PaginatedLegislativeCommittees> {
    if (!this.db) return { items: [], total: 0, hasMore: false };

    const { skip, take, chamber, nameFilter } = args;
    const trimmedFilter = nameFilter?.trim();
    const where = {
      deletedAt: null,
      ...(chamber ? { chamber } : {}),
      ...(trimmedFilter
        ? { name: { contains: trimmedFilter, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.legislativeCommittee.findMany({
        where,
        select: {
          id: true,
          externalId: true,
          name: true,
          chamber: true,
          url: true,
          description: true,
          _count: { select: { assignments: true } },
        },
        orderBy: [{ chamber: 'asc' }, { name: 'asc' }],
        skip,
        // Fetch one extra to compute hasMore without a second count query.
        take: take + 1,
      }),
      this.db.legislativeCommittee.count({ where }),
    ]);

    const hasMore = rows.length > take;
    const items = rows.slice(0, take).map((r) => ({
      id: r.id,
      externalId: r.externalId,
      name: r.name,
      chamber: r.chamber,
      url: r.url,
      description: r.description,
      memberCount: r._count.assignments,
    }));

    return { items, total, hasMore };
  }

  /**
   * Detail view. Members are sorted by canonical role (Chair → Vice Chair
   * → Member → other) then by lastName. Hearings are best-effort fuzzy
   * matches against Meeting.title in the same chamber.
   */
  async getDetail(id: string): Promise<LegislativeCommitteeDetail | null> {
    if (!this.db) return null;

    const committee = await this.db.legislativeCommittee.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignments: {
          include: {
            representative: {
              select: {
                id: true,
                name: true,
                lastName: true,
                party: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!committee) return null;

    // Sort first using the source `lastName` field, then project — avoids
    // having to drop a private `lastName` from the output rows after the
    // sort. Spread to a fresh array so we don't mutate Prisma's result.
    const members = [...committee.assignments]
      .sort((a, b) => {
        const aIdx = this.roleIndex(a.role);
        const bIdx = this.roleIndex(b.role);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.representative.lastName.localeCompare(
          b.representative.lastName,
        );
      })
      .map((a) => ({
        representativeId: a.representative.id,
        name: a.representative.name,
        role: a.role,
        party: a.representative.party,
        photoUrl: a.representative.photoUrl,
      }));

    const hearings = await this.fuzzyHearings(
      committee.name,
      committee.chamber,
    );

    return {
      id: committee.id,
      externalId: committee.externalId,
      name: committee.name,
      chamber: committee.chamber,
      url: committee.url,
      description: committee.description,
      memberCount: committee.assignments.length,
      members,
      hearings,
      activitySummary: committee.activitySummary,
      activitySummaryGeneratedAt: committee.activitySummaryGeneratedAt,
      activitySummaryWindowDays: committee.activitySummaryWindowDays,
      createdAt: committee.createdAt,
      updatedAt: committee.updatedAt,
    };
  }

  /**
   * Best-effort hearing match: any Meeting in the same chamber whose
   * title contains the committee's name (case-insensitive), scheduled in
   * the last HEARING_WINDOW_MONTHS, ordered most-recent-first, capped at
   * HEARING_LIMIT. Phase 2 will replace with an explicit FK.
   *
   * Two defenses against known scrape bugs (issues filed separately):
   *
   * 1. The Assembly scrape currently produces duplicate Meeting rows for
   *    the same hearing — same title, date, agenda URL, just stored 2-4
   *    times. Dedupe here on (title, scheduledAt) so the UI shows one
   *    row per hearing. When duplicates exist with mixed absolute/relative
   *    URLs, prefer the absolute one.
   * 2. Some `agenda_url` values are stored as relative paths
   *    (`/api/dailyfile/...`) instead of absolute URLs. The frontend
   *    would resolve those against its own origin and 404. Drop any
   *    URL that doesn't look like an absolute http(s) URL — the frontend
   *    already hides the agenda link when the URL is null.
   */
  private async fuzzyHearings(
    committeeName: string,
    chamber: string,
  ): Promise<LegislativeCommitteeHearing[]> {
    if (!this.db) return [];

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - HEARING_WINDOW_MONTHS);

    // Pull more than HEARING_LIMIT so dedup doesn't shrink the visible
    // set below the cap on a duplicate-heavy chamber.
    const meetings = await this.db.meeting.findMany({
      where: {
        deletedAt: null,
        body: chamber,
        scheduledAt: { gte: cutoff },
        title: { contains: committeeName, mode: 'insensitive' },
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        agendaUrl: true,
      },
      orderBy: { scheduledAt: 'desc' },
      take: HEARING_LIMIT * 4,
    });

    const seen = new Map<string, LegislativeCommitteeHearing>();
    for (const m of meetings) {
      const key = `${m.title}::${m.scheduledAt.toISOString()}`;
      const agendaUrl = this.absoluteUrlOrNull(m.agendaUrl);
      const existing = seen.get(key);
      // Prefer the row with a usable absolute URL; otherwise keep the first.
      if (!existing || (!existing.agendaUrl && agendaUrl)) {
        seen.set(key, {
          id: m.id,
          title: m.title,
          scheduledAt: m.scheduledAt,
          agendaUrl,
        });
      }
    }

    return Array.from(seen.values()).slice(0, HEARING_LIMIT);
  }

  private absoluteUrlOrNull(url: string | null): string | null {
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : null;
  }

  /**
   * Map a canonical role string to a sort index. Unrecognized roles fall
   * to the end of the list so we don't lose them, just rank them last.
   */
  private roleIndex(role: string | null): number {
    if (!role) return ROLE_SORT_ORDER.length;
    const idx = ROLE_SORT_ORDER.indexOf(role);
    return idx >= 0 ? idx : ROLE_SORT_ORDER.length;
  }
}

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Shape of one entry inside Representative.committees JSON.
 * Matches CommitteeAssignment from @opuspopuli/common — repeated here as
 * a private interface so the service doesn't pull in the whole common
 * package just to type a JSON cast.
 */
interface RawCommitteeAssignment {
  name?: string;
  role?: string | null;
  url?: string | null;
}

/** Canonical role buckets we collapse the noisy scraped role strings into. */
type CanonicalRole = 'Chair' | 'Vice Chair' | 'Member';

/** Per-rep, per-committee tuple emitted in phase 1, consumed in phase 3. */
interface Membership {
  representativeId: string;
  committeeKey: string;
  role: CanonicalRole;
}

const VICE_CHAIR_PATTERN = /\bvice[\s-]?chair\b/i;
const CHAIR_PATTERN = /\bchair\b/i;

/**
 * Links Representatives to LegislativeCommittees by walking each rep's
 * `committees` JSON column and materializing the relational graph:
 * distinct LegislativeCommittee rows + RepresentativeCommitteeAssignment
 * join rows. Idempotent — re-running over unchanged data produces zero
 * writes thanks to the unique constraints on
 * (legislative_committees.external_id) and
 * (representative_committee_assignments.{representative_id, legislative_committee_id}).
 *
 * Naming follows the established `*-linker` convention
 * (PropositionFinanceLinkerService) — services that connect entity rows
 * by populating join tables / FKs, even when one side is materialized
 * along the way as derived state.
 *
 * Mirrors the optional-deps + post-sync-hook pattern of BioGeneratorService
 * — no-ops gracefully when DB isn't wired (e.g., narrow unit-test contexts).
 *
 * Run automatically after every `syncRepresentatives` pass; also exposed
 * via a one-off bootstrap script for ad-hoc runs.
 *
 * Tunables (env):
 *   LEGISLATIVE_COMMITTEE_LINKER_BATCH_SIZE — default 50; how many
 *   representatives to read in one DB page when paginating the source.
 */
@Injectable()
export class LegislativeCommitteeLinkerService {
  private readonly logger = new Logger(LegislativeCommitteeLinkerService.name);
  private readonly batchSize: number;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly db?: DbService,
  ) {
    this.batchSize = this.readPositiveInt(
      'LEGISLATIVE_COMMITTEE_LINKER_BATCH_SIZE',
      50,
    );
  }

  /**
   * Walk every active Representative's `committees` JSON, derive the set
   * of distinct (chamber, name) committees, upsert into legislative_committees,
   * then upsert the membership rows. Returns counts so callers can log.
   *
   * Three phases broken out as helpers below:
   *   1. collectFromReps  — read JSONB into in-memory committee + membership maps
   *   2. upsertCommittees — materialize one LegislativeCommittee row per key
   *   3. upsertMemberships — materialize the join rows (dedup'd on (rep, committee))
   */
  async linkAll(): Promise<{
    committeesUpserted: number;
    assignmentsUpserted: number;
    repsScanned: number;
    skipped: number;
  }> {
    if (!this.db) {
      return {
        committeesUpserted: 0,
        assignmentsUpserted: 0,
        repsScanned: 0,
        skipped: 0,
      };
    }

    const collected = await this.collectFromReps();
    const keyToId = await this.upsertCommittees(collected.committeeMap);
    const assignmentsUpserted = await this.upsertMemberships(
      collected.memberships,
      keyToId,
    );

    this.logger.log(
      `Legislative committee linker complete: ` +
        `committees=${collected.committeeMap.size} assignments=${assignmentsUpserted} ` +
        `reps=${collected.repsScanned} skipped=${collected.skipped}`,
    );

    return {
      committeesUpserted: collected.committeeMap.size,
      assignmentsUpserted,
      repsScanned: collected.repsScanned,
      skipped: collected.skipped,
    };
  }

  /**
   * Phase 1: paginate through every active rep, accumulate the distinct
   * committee map (keyed by `<chamber>:<normalizedName>`) and the per-rep
   * membership tuples. Skip reps with null/non-array `committees` payloads
   * and committee entries with missing/empty names.
   */
  private async collectFromReps(): Promise<{
    committeeMap: Map<string, { chamber: string; name: string }>;
    memberships: Membership[];
    repsScanned: number;
    skipped: number;
  }> {
    const committeeMap = new Map<string, { chamber: string; name: string }>();
    const memberships: Membership[] = [];
    let cursor: string | undefined;
    let repsScanned = 0;
    let skipped = 0;

    for (;;) {
      const reps = await this.fetchRepBatch(cursor);
      if (reps.length === 0) break;
      cursor = reps.at(-1)!.id;

      for (const rep of reps) {
        repsScanned++;
        const accepted = this.processRepCommittees(
          rep,
          committeeMap,
          memberships,
        );
        if (!accepted) skipped++;
      }

      if (reps.length < this.batchSize) break;
    }

    return { committeeMap, memberships, repsScanned, skipped };
  }

  /**
   * Read a single page of reps. Prisma's JSON null-filter syntax is
   * awkward; we just read every active rep and let coerceAssignments()
   * filter null/empty payloads at the app level. Dataset is small
   * (O(hundreds)).
   */
  private async fetchRepBatch(
    cursor: string | undefined,
  ): Promise<Array<{ id: string; chamber: string; committees: unknown }>> {
    return this.db!.representative.findMany({
      where: { deletedAt: null },
      select: { id: true, chamber: true, committees: true },
      orderBy: { id: 'asc' },
      take: this.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  /**
   * Process a single rep's `committees` JSONB: append distinct committee
   * keys to `committeeMap` and per-assignment tuples to `memberships`.
   * Returns true when at least one assignment was kept (i.e. the rep
   * counts toward the "scanned" total instead of "skipped").
   */
  private processRepCommittees(
    rep: { id: string; chamber: string; committees: unknown },
    committeeMap: Map<string, { chamber: string; name: string }>,
    memberships: Membership[],
  ): boolean {
    const assignments = this.coerceAssignments(rep.committees);
    if (assignments.length === 0) return false;

    for (const a of assignments) {
      const rawName = a.name?.trim();
      if (!rawName) continue;
      const normalized = this.normalize(rawName);
      if (!normalized) continue;
      const key = this.externalId(rep.chamber, normalized);

      // First time we see this committee key, register canonical
      // metadata. We pick the longest scraped name as the display
      // form on the assumption that fuller phrasings ("Standing
      // Committee on Budget") are typically the official name.
      const existing = committeeMap.get(key);
      if (!existing || rawName.length > existing.name.length) {
        committeeMap.set(key, { chamber: rep.chamber, name: rawName });
      }

      memberships.push({
        representativeId: rep.id,
        committeeKey: key,
        role: this.canonicalizeRole(a.role),
      });
    }
    return true;
  }

  /**
   * Phase 2: upsert each distinct committee row, capturing its db id so
   * phase 3 can resolve membership FKs.
   */
  private async upsertCommittees(
    committeeMap: Map<string, { chamber: string; name: string }>,
  ): Promise<Map<string, string>> {
    const keyToId = new Map<string, string>();
    for (const [key, meta] of committeeMap.entries()) {
      const row = await this.db!.legislativeCommittee.upsert({
        where: { externalId: key },
        update: { name: meta.name, chamber: meta.chamber },
        create: {
          externalId: key,
          name: meta.name,
          chamber: meta.chamber,
        },
        select: { id: true },
      });
      keyToId.set(key, row.id);
    }
    return keyToId;
  }

  /**
   * Phase 3: upsert each membership tuple. Dedup on
   * (representativeId, committeeId) — a single rep listed twice on the
   * same committee with different role spellings just settles on the
   * canonicalized role from the latest entry.
   */
  private async upsertMemberships(
    memberships: Membership[],
    keyToId: Map<string, string>,
  ): Promise<number> {
    const seen = new Set<string>();
    let count = 0;
    for (const m of memberships) {
      const committeeId = keyToId.get(m.committeeKey);
      if (!committeeId) continue;
      const dedupKey = `${m.representativeId}::${committeeId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      await this.db!.representativeCommitteeAssignment.upsert({
        where: {
          representativeId_legislativeCommitteeId: {
            representativeId: m.representativeId,
            legislativeCommitteeId: committeeId,
          },
        },
        update: { role: m.role },
        create: {
          representativeId: m.representativeId,
          legislativeCommitteeId: committeeId,
          role: m.role,
        },
      });
      count++;
    }
    return count;
  }

  /**
   * Validate + coerce the JSONB `committees` column to a typed array.
   * Returns `[]` for null, non-array, or all-malformed payloads. Element
   * shape is loose because scrape sources have drifted historically; we
   * just need a `name` string to do anything useful.
   */
  private coerceAssignments(raw: unknown): RawCommitteeAssignment[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        name: typeof x.name === 'string' ? x.name : undefined,
        role: typeof x.role === 'string' ? x.role : null,
        url: typeof x.url === 'string' ? x.url : null,
      }));
  }

  /**
   * Normalize a committee name into a stable lookup key. Strategy:
   *  - lowercase
   *  - drop non-alphanumeric (keeps only letters, digits, single spaces)
   *  - drop chamber-prefix words (Assembly, Senate) since chamber is in
   *    the key separately
   *  - drop "committee", "committee on", "standing committee on" wrappers
   *  - collapse whitespace
   * Result for "Standing Committee on the Budget" / "Budget" /
   *   "Budget Committee" / "Assembly Budget" → all collapse to "budget".
   */
  private normalize(name: string): string {
    let n = name.toLowerCase().replaceAll(/[^a-z0-9\s]/g, ' ');
    // Strip wrapper phrases — order matters, longer-first.
    n = n
      .replaceAll(/\bstanding committee on the\b/g, ' ')
      .replaceAll(/\bstanding committee on\b/g, ' ')
      .replaceAll(/\bcommittee on the\b/g, ' ')
      .replaceAll(/\bcommittee on\b/g, ' ')
      .replaceAll(/\bsubcommittee on\b/g, ' ')
      .replaceAll(/\bcommittee\b/g, ' ')
      .replaceAll(/\bsubcommittee\b/g, ' ')
      .replaceAll(/\bassembly\b/g, ' ')
      .replaceAll(/\bsenate\b/g, ' ');
    return n.replaceAll(/\s+/g, ' ').trim();
  }

  /** Build the unique external_id for a (chamber, normalized name) pair. */
  private externalId(chamber: string, normalizedName: string): string {
    return `${chamber.toLowerCase()}:${normalizedName}`;
  }

  /**
   * Public helper for callers that need to resolve a raw scrape committee
   * name (e.g. an entry from `Representative.committees` JSONB) to the
   * canonical external id used by the LegislativeCommittee table. Returns
   * null when the name doesn't normalize to anything useful.
   *
   * Exposed so the rep query resolver can look up the matching
   * LegislativeCommittee.id without duplicating normalization logic.
   */
  externalIdFor(chamber: string, rawName: string): string | null {
    const normalized = this.normalize(rawName);
    if (!normalized) return null;
    return this.externalId(chamber, normalized);
  }

  /**
   * Canonicalize a scraped role string. Returns one of three buckets:
   * Chair, Vice Chair, Member. "Vice Chair" is checked before "Chair"
   * because the chair pattern is a substring of the vice-chair phrase.
   */
  private canonicalizeRole(raw: string | null | undefined): CanonicalRole {
    if (!raw) return 'Member';
    if (VICE_CHAIR_PATTERN.test(raw)) return 'Vice Chair';
    if (CHAIR_PATTERN.test(raw)) return 'Chair';
    return 'Member';
  }

  private readPositiveInt(envKey: string, fallback: number): number {
    const raw = this.config?.get<string>(envKey);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

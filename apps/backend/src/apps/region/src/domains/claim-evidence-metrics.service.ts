import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { Gauge } from 'prom-client';
import type { ClaimSubjectType } from './claim-normalisers';
import type { VerifiedState } from './evidence-verifier';

/**
 * The families that carry claims, listed rather than discovered.
 *
 * A gauge keeps the last value written to a label set forever, so deriving
 * labels from whatever the query returned would leave a family's number frozen
 * at its last non-zero reading the moment it stopped appearing. Writing an
 * explicit zero for every known family each cycle is what makes "none" and
 * "no longer measured" different.
 */
const FAMILIES: readonly ClaimSubjectType[] = [
  'proposition',
  'minutes',
  'representative',
];

const STATES: readonly VerifiedState[] = [
  'verified',
  'snapped',
  'unverified',
  'unsourced',
];

/** One row of the per-family, per-state evidence count. */
interface StateRow {
  subject_type: string;
  state: string;
  count: bigint;
}

/**
 * Publish the epic's target property as a watched number (#1296, #1208).
 *
 * > Show every published assertion that lacks primary evidence.
 *
 * Before #1291–#1294 that was not a hard query but an impossible one — claims
 * lived in three incompatible JSONB columns, none joinable. It is now a
 * `groupBy`, and this turns it from a query someone could write into a number
 * somebody watches.
 *
 * **Labelled per family, never aggregated.** Representative bio claims cite
 * structured fields rather than text spans, so that family is 100% unevidenced
 * by construction rather than by failure. An aggregate would let 751
 * structurally-unverifiable claims swamp the 469 that genuinely failed a
 * check, and the number would stop meaning anything.
 *
 * Expect the number to start bad: 1,333 of 1,497 at the pre-refresh baseline.
 * A gauge reporting a comfortable figure on day one would mean the gate was
 * skipped.
 */
@Injectable()
export class ClaimEvidenceMetricsService implements OnModuleInit {
  private readonly logger = new Logger(ClaimEvidenceMetricsService.name);

  constructor(
    private readonly db: DbService,
    @InjectMetric('claims_total')
    private readonly total: Gauge<string>,
    @InjectMetric('claims_unevidenced')
    private readonly unevidenced: Gauge<string>,
    @InjectMetric('claims_superseded')
    private readonly superseded: Gauge<string>,
    @InjectMetric('claim_evidence_state')
    private readonly byState: Gauge<string>,
    @InjectMetric('claims_last_measured_timestamp_seconds')
    private readonly lastMeasured: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Measure once at boot rather than waiting five minutes for the first
    // cron tick, so a freshly started service is never reporting nothing.
    await this.measure();
  }

  @Cron('*/5 * * * *')
  async measure(): Promise<void> {
    try {
      const [totals, unevidenced, superseded, states] = await Promise.all([
        this.countByFamily(),
        this.countUnevidencedByFamily(),
        this.countSupersededByFamily(),
        this.countEvidenceByState(),
      ]);

      // Known families get an explicit zero so a family that stops appearing
      // is not frozen at its last reading; families only present in the data
      // are added so a fourth one is never silently omitted from the number
      // the epic is judged on. Taking the union gets both properties — either
      // list alone loses one of them.
      const observed = new Set<string>([
        ...FAMILIES,
        ...totals.keys(),
        ...unevidenced.keys(),
        ...superseded.keys(),
      ]);

      for (const family of observed) {
        this.total.set({ subject_type: family }, totals.get(family) ?? 0);
        this.unevidenced.set(
          { subject_type: family },
          unevidenced.get(family) ?? 0,
        );
        this.superseded.set(
          { subject_type: family },
          superseded.get(family) ?? 0,
        );
        for (const state of STATES) {
          this.byState.set(
            { subject_type: family, state },
            states.get(`${family}:${state}`) ?? 0,
          );
        }
      }

      this.lastMeasured.set(Math.floor(Date.now() / 1000));
    } catch (error) {
      // Deliberately leaves every value gauge untouched. Publishing zero here
      // would report a fully-evidenced corpus, which looks identical to a
      // corpus nobody could measure — and would leave the freshness gauge as
      // the only signal that anything was wrong. Production backups died
      // unnoticed for 49 days on exactly that shape of mistake (#1217, #1278).
      this.logger.warn(
        `Failed to measure claim evidence: ${(error as Error).message}`,
      );
    }
  }

  /** Claims per family — the denominator. */
  private async countByFamily(): Promise<Map<string, number>> {
    const rows = await this.db.claim.groupBy({
      by: ['subjectType'],
      // Current generation only (#1295). Counting superseded claims would
      // make the corpus appear to grow with every regeneration, and
      // `claims_unevidenced` would climb precisely as the corpus improved.
      where: { validUntil: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.subjectType, r._count._all]));
  }

  /**
   * Claims with no verified evidence — the epic's property, verbatim.
   *
   * `none` rather than a count comparison: a claim with three pieces of
   * evidence, none verified, is as unevidenced as one with no evidence at all.
   */
  private async countUnevidencedByFamily(): Promise<Map<string, number>> {
    const rows = await this.db.claim.groupBy({
      by: ['subjectType'],
      where: {
        validUntil: null,
        evidence: { none: { evidence: { state: 'verified' } } },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.subjectType, r._count._all]));
  }

  /**
   * Retained superseded generations, per family (#1295).
   *
   * Only genuine changes create one — an identical regeneration is a no-op —
   * so this is a direct measure of how much the corpus has actually moved
   * across refreshes, and of what retention is costing.
   */
  private async countSupersededByFamily(): Promise<Map<string, number>> {
    const rows = await this.db.claim.groupBy({
      by: ['subjectType'],
      where: { validUntil: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.subjectType, r._count._all]));
  }

  /**
   * The full verdict distribution, per family.
   *
   * Raw SQL because this spans claims → claim_evidence → evidence, and Prisma
   * cannot group across a join. Parameterless: the label values are the
   * constants above, never caller input.
   */
  private async countEvidenceByState(): Promise<Map<string, number>> {
    const rows = await this.db.$queryRaw<StateRow[]>`
      SELECT c.subject_type, e.state::text AS state, COUNT(*) AS count
        FROM claims c
        JOIN claim_evidence ce ON ce.claim_id = c.id
        JOIN evidence e ON e.id = ce.evidence_id
       WHERE c.valid_until IS NULL
       GROUP BY c.subject_type, e.state
    `;
    return new Map(
      rows.map((r) => [`${r.subject_type}:${r.state}`, Number(r.count)]),
    );
  }
}

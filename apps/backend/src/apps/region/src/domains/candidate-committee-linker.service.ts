import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { batchTransaction } from '@opuspopuli/common';

/** A rep-index slot that resolved to more than one representative. */
const AMBIGUOUS = Symbol('ambiguous');
type RepSlot = string | typeof AMBIGUOUS;

export interface CandidateCommitteeLinkResult {
  linked: number;
  skippedAmbiguous: number;
  unmatched: number;
  candidateCommittees: number;
}

/**
 * Link candidate campaign committees to the representatives we track, so the
 * money (contributions/expenditures a committee raised) becomes attributable
 * to a named official (#941, epic #936).
 *
 * Matches a committee's `candidateName` (last name — CAL-ACCESS `CAND_NAML`)
 * + `candidateOffice` (`OFFICE_CD` → chamber) against `Representative.lastName`
 * + `chamber`. Only **unambiguous** matches are linked: a last name shared by
 * two or more representatives in the same chamber is skipped, never
 * mis-linked (the #908 discipline). Idempotent and safe to run after every
 * campaign-finance sync — it only considers committees not yet linked.
 */
@Injectable()
export class CandidateCommitteeLinkerService {
  private readonly logger = new Logger(CandidateCommitteeLinkerService.name);

  constructor(@Optional() private readonly db?: DbService) {}

  async linkAll(): Promise<CandidateCommitteeLinkResult> {
    const empty: CandidateCommitteeLinkResult = {
      linked: 0,
      skippedAmbiguous: 0,
      unmatched: 0,
      candidateCommittees: 0,
    };
    if (!this.db) return empty;

    const repIndex = await this.buildRepIndex();
    if (repIndex.size === 0) return empty;

    const committees = await this.db.committee.findMany({
      where: {
        type: 'candidate',
        candidateName: { not: null },
        representativeId: null,
        // Only CAL-ACCESS (state) committees carry ASM/SEN offices that map to
        // our tracked legislators; skip the recurring no-op scan over FEC rows.
        sourceSystem: 'cal_access',
        deletedAt: null,
      },
      select: { id: true, candidateName: true, candidateOffice: true },
    });

    const updates: Array<{ id: string; representativeId: string }> = [];
    let skippedAmbiguous = 0;
    let unmatched = 0;

    for (const c of committees) {
      const chamber = this.officeToChamber(c.candidateOffice);
      // candidateName is CAL-ACCESS CAND_NAML (last name); defensively take the
      // portion before a comma in case a filing carries "Last, First".
      const last = (c.candidateName ?? '').split(',')[0];
      const key = chamber ? this.repKey(last, chamber) : null;
      const hit = key ? repIndex.get(key) : undefined;
      if (hit === AMBIGUOUS) {
        skippedAmbiguous++;
      } else if (hit) {
        updates.push({ id: c.id, representativeId: hit });
      } else {
        unmatched++;
      }
    }

    if (updates.length > 0) {
      await batchTransaction(
        this.db,
        updates.map((u) =>
          this.db!.committee.update({
            where: { id: u.id },
            data: { representativeId: u.representativeId },
          }),
        ),
      );
    }

    const result: CandidateCommitteeLinkResult = {
      linked: updates.length,
      skippedAmbiguous,
      unmatched,
      candidateCommittees: committees.length,
    };
    this.logger.log(
      `Candidate-committee linker: linked=${result.linked}, ` +
        `ambiguous=${result.skippedAmbiguous}, unmatched=${result.unmatched} ` +
        `(of ${result.candidateCommittees} candidate committees)`,
    );
    return result;
  }

  /** Build `normalize(lastName)|chamber` → repId, marking collisions AMBIGUOUS. */
  private async buildRepIndex(): Promise<Map<string, RepSlot>> {
    const reps = await this.db!.representative.findMany({
      // Exclude federal reps: a US-Senate rep (chamber "Senate") would
      // otherwise collide with CA State Senate on the last-name+chamber key.
      where: { deletedAt: null, regionId: { not: 'federal' } },
      select: { id: true, lastName: true, name: true, chamber: true },
    });
    const index = new Map<string, RepSlot>();
    for (const r of reps) {
      const last = r.lastName || this.lastNameOf(r.name);
      if (!this.normalize(last) || !r.chamber) continue;
      const key = this.repKey(last, r.chamber);
      const existing = index.get(key);
      if (existing && existing !== r.id) {
        index.set(key, AMBIGUOUS);
      } else if (!existing) {
        index.set(key, r.id);
      }
    }
    return index;
  }

  private repKey(lastName: string, chamber: string): string {
    return `${this.normalize(lastName)}|${chamber.toLowerCase().trim()}`;
  }

  /** CAL-ACCESS OFFICE_CD → Representative.chamber. Null skips the committee. */
  private officeToChamber(office: string | null | undefined): string | null {
    if (!office) return null;
    switch (office.toUpperCase().trim()) {
      case 'ASM':
      case 'ASSEMBLY':
        return 'Assembly';
      case 'SEN':
      case 'SENATE':
        return 'Senate';
      default:
        return null;
    }
  }

  private lastNameOf(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1];
  }

  /**
   * Collapse a last name to a comparison key by stripping ALL non-alphanumeric
   * characters (not just punctuation → space). CAL-ACCESS frequently drops
   * apostrophes/hyphens/spaces ("OBRIEN", "DELEON") while our scraped names
   * keep them ("O'Brien", "De Leon"), so both sides must reduce to the same
   * token ("obrien", "deleon").
   */
  private normalize(value: string): string {
    return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  }
}

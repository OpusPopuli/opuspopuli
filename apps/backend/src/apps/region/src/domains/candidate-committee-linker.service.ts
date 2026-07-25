import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { batchTransaction } from '@opuspopuli/common';

/** A rep-index slot that resolved to more than one representative. */
const AMBIGUOUS = Symbol('ambiguous');
type RepSlot = string | typeof AMBIGUOUS;

export interface CandidateCommitteeLinkResult {
  linked: number;
  skippedAmbiguous: number;
  /** Name/office matched a rep, but the committee is not the candidate's OWN
   * controlled committee (a support/oppose, ballot-measure, sponsored, or PAC
   * committee that merely references the candidate). Never attributed (#953). */
  skippedNonControlled: number;
  unmatched: number;
  candidateCommittees: number;
}

/**
 * Markers in a committee NAME that identify it as a support/oppose, ballot-
 * measure, sponsored, or general-purpose committee rather than the candidate's
 * OWN controlled committee. CAL-ACCESS populates CAND_NAML/OFFICE_CD on the
 * cover page of ANY committee that references a candidate, so those fields alone
 * mislinked union PACs, IE committees, and ballot-measure committees to
 * legislators (#953). The committee name is the reliable signal.
 */
const NON_CONTROLLED_MARKERS = [
  'in support of',
  'in opposition to',
  'opposed to',
  'opposing',
  'supporting',
  'sponsored by',
  'ballot measure',
  'independent expenditure',
  'recall',
];

/** Lowercase and collapse every run of non-alphanumerics to a single space —
 * used for phrase-marker matching (keeps word boundaries). */
function soften(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lowercase and drop everything but [a-z0-9]. Matches the surname key the
 * linker builds, so "O'Brien" / "OBRIEN" / "Alvarado-Gil" reduce to one token
 * regardless of how CAL-ACCESS punctuates the committee name. */
function alnumKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Below this many alnum chars a surname can't be substring-gated without false
 * matches (e.g. "Vo" inside "vote"); such reps fall back to office/name + marker
 * matching only. */
const SURNAME_MIN_GATE_LEN = 3;

/**
 * True only when a committee looks like the candidate's OWN controlled
 * committee: (1) the committee name carries no support/oppose/ballot/sponsored
 * marker (those name the candidate but spend independently), and (2) the name
 * actually contains the candidate surname — a real controlled committee is
 * titled after them ("{Surname} for Assembly", "Friends of {Surname}"), while a
 * union/issue PAC is not. Surname matching uses the alnum key so it tolerates
 * CAL-ACCESS punctuation ("O'Brien" vs "OBRIEN") and hyphenated names (#953).
 */
export function isCandidateOwnCommittee(
  committeeName: string,
  surname: string,
): boolean {
  const softened = soften(committeeName);
  if (NON_CONTROLLED_MARKERS.some((marker) => softened.includes(marker))) {
    return false;
  }
  const surnameKey = alnumKey(surname);
  if (surnameKey.length < SURNAME_MIN_GATE_LEN) return true;
  return alnumKey(committeeName).includes(surnameKey);
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
      skippedNonControlled: 0,
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
      select: {
        id: true,
        name: true,
        candidateName: true,
        candidateOffice: true,
      },
    });

    const updates: Array<{ id: string; representativeId: string }> = [];
    let skippedAmbiguous = 0;
    let skippedNonControlled = 0;
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
      } else if (!hit) {
        unmatched++;
      } else if (!isCandidateOwnCommittee(c.name, last)) {
        // Name/office matched a rep, but the committee only references the
        // candidate (IE/ballot-measure/sponsored/PAC) — not their controlled
        // committee. Never attribute it, or the money trail shows money that is
        // not the representative's (#953).
        skippedNonControlled++;
      } else {
        updates.push({ id: c.id, representativeId: hit });
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
      skippedNonControlled,
      unmatched,
      candidateCommittees: committees.length,
    };
    this.logger.log(
      `Candidate-committee linker: linked=${result.linked}, ` +
        `ambiguous=${result.skippedAmbiguous}, ` +
        `nonControlled=${result.skippedNonControlled}, ` +
        `unmatched=${result.unmatched} ` +
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

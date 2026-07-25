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
  /** Previously-linked committees that no longer pass the controlled-committee
   * gate and were unlinked this run — self-heals stale links from before #953
   * without manual SQL. */
  reconciledUnlinked: number;
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
 * Infer which chamber a controlled committee is for from its name
 * ("… for Assembly", "… for State Senate"). Used to recover the chamber when a
 * committee has no OFFICE_CD (#953 yield). Null when neither chamber appears.
 */
export function chamberFromName(name: string): 'Assembly' | 'Senate' | null {
  const n = soften(name);
  if (n.includes('assembly')) return 'Assembly';
  if (n.includes('senate')) return 'Senate';
  return null;
}

/** A representative reduced to what surname-in-name matching needs. */
interface RepEntry {
  id: string;
  surname: string;
  surnameKey: string;
}

/** Outcome of resolving a committee to a representative. */
type Resolution =
  | { kind: 'match'; repId: string; surname: string }
  | { kind: 'ambiguous' }
  | { kind: 'unmatched' };

/** The rep-row shape both index builders read. */
type RepRow = {
  id: string;
  lastName: string;
  name: string;
  chamber: string;
};

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
      reconciledUnlinked: 0,
      unmatched: 0,
      candidateCommittees: 0,
    };
    if (!this.db) return empty;

    const reps = await this.loadReps();
    const repIndex = this.buildRepIndex(reps);
    // Guard: an empty rep index means reps aren't loaded (transient/degenerate)
    // — do NOT reconcile then, or a bad load would nuke every existing link.
    if (repIndex.size === 0) return empty;
    const repsByChamber = this.buildRepsByChamber(reps);

    // Self-heal first: unlink any currently-linked committee that no longer
    // passes the controlled-committee gate (e.g. links made before #953). This
    // removes the need to manually clear representative_id before a re-sync.
    const reconciledUnlinked = await this.reconcileExistingLinks();

    // Consider every unlinked CAL-ACCESS candidate committee — INCLUDING those
    // missing CAND_NAML. A controlled committee is still titled after the
    // candidate ("Friends of {name} for Senate"), so we recover the rep from the
    // committee NAME when the field is blank (#953 yield). Only CAL-ACCESS
    // committees carry ASM/SEN offices that map to our tracked legislators.
    const committees = await this.db.committee.findMany({
      where: {
        type: 'candidate',
        representativeId: null,
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
      const res = this.resolveRep(c, repIndex, repsByChamber);
      if (res.kind === 'ambiguous') {
        skippedAmbiguous++;
      } else if (res.kind === 'unmatched') {
        unmatched++;
      } else if (!isCandidateOwnCommittee(c.name, res.surname)) {
        // Matched a rep, but the committee only references the candidate
        // (IE/ballot-measure/sponsored/PAC) — not their controlled committee.
        // Never attribute it, or the money trail shows money that isn't the
        // representative's (#953).
        skippedNonControlled++;
      } else {
        updates.push({ id: c.id, representativeId: res.repId });
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
      reconciledUnlinked,
      unmatched,
      candidateCommittees: committees.length,
    };
    this.logger.log(
      `Candidate-committee linker: linked=${result.linked}, ` +
        `ambiguous=${result.skippedAmbiguous}, ` +
        `nonControlled=${result.skippedNonControlled}, ` +
        `reconciledUnlinked=${result.reconciledUnlinked}, ` +
        `unmatched=${result.unmatched} ` +
        `(of ${result.candidateCommittees} candidate committees)`,
    );
    return result;
  }

  /**
   * Re-validate already-linked candidate committees against the controlled-
   * committee gate and unlink any that no longer qualify. This self-heals stale
   * attributions — e.g. the IE / ballot-measure / union-PAC links made before
   * the #953 gate existed — so operators never have to null `representative_id`
   * by hand before a re-sync. Only touches CAL-ACCESS candidate committees that
   * are currently linked; correctly-linked controlled committees are untouched.
   */
  private async reconcileExistingLinks(): Promise<number> {
    const linked = await this.db!.committee.findMany({
      where: {
        representativeId: { not: null },
        type: 'candidate',
        sourceSystem: 'cal_access',
        deletedAt: null,
      },
      select: { id: true, name: true, candidateName: true },
    });
    const stale = linked.filter(
      (c) =>
        !isCandidateOwnCommittee(c.name, (c.candidateName ?? '').split(',')[0]),
    );
    if (stale.length > 0) {
      await batchTransaction(
        this.db!,
        stale.map((c) =>
          this.db!.committee.update({
            where: { id: c.id },
            data: { representativeId: null },
          }),
        ),
      );
    }
    return stale.length;
  }

  /** Load tracked (non-federal) reps once; both index builders read the result. */
  private async loadReps(): Promise<RepRow[]> {
    // Exclude federal reps: a US-Senate rep (chamber "Senate") would otherwise
    // collide with CA State Senate on the last-name+chamber key.
    return this.db!.representative.findMany({
      where: { deletedAt: null, regionId: { not: 'federal' } },
      select: { id: true, lastName: true, name: true, chamber: true },
    });
  }

  /** Build `normalize(lastName)|chamber` → repId, marking collisions AMBIGUOUS. */
  private buildRepIndex(reps: RepRow[]): Map<string, RepSlot> {
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

  /** Group reps by lowercased chamber for surname-in-name recovery (#953). */
  private buildRepsByChamber(reps: RepRow[]): Map<string, RepEntry[]> {
    const byChamber = new Map<string, RepEntry[]>();
    for (const r of reps) {
      const surname = r.lastName || this.lastNameOf(r.name);
      const surnameKey = this.normalize(surname);
      if (!surnameKey || !r.chamber) continue;
      const chamberKey = r.chamber.toLowerCase().trim();
      const list = byChamber.get(chamberKey) ?? [];
      list.push({ id: r.id, surname, surnameKey });
      byChamber.set(chamberKey, list);
    }
    return byChamber;
  }

  /**
   * Resolve a committee to a representative. Primary path uses CAND_NAML +
   * OFFICE_CD; when CAND_NAML is absent (#953 yield) the chamber is inferred
   * from the name and the surname is recovered by finding the unique tracked
   * rep in that chamber whose surname appears in the committee name.
   */
  private resolveRep(
    c: {
      name: string;
      candidateName: string | null;
      candidateOffice: string | null;
    },
    repIndex: Map<string, RepSlot>,
    repsByChamber: Map<string, RepEntry[]>,
  ): Resolution {
    const chamber =
      this.officeToChamber(c.candidateOffice) ?? chamberFromName(c.name);
    if (!chamber) return { kind: 'unmatched' };
    if (c.candidateName) {
      // candidateName is CAND_NAML (last name); take the part before a comma in
      // case a filing carries "Last, First".
      const last = c.candidateName.split(',')[0];
      const hit = repIndex.get(this.repKey(last, chamber));
      if (hit === AMBIGUOUS) return { kind: 'ambiguous' };
      if (hit) return { kind: 'match', repId: hit, surname: last };
      return { kind: 'unmatched' };
    }
    return this.resolveByName(c.name, chamber, repsByChamber);
  }

  /** Recover the rep for a CAND_NAML-less committee by unique surname-in-name. */
  private resolveByName(
    name: string,
    chamber: string,
    repsByChamber: Map<string, RepEntry[]>,
  ): Resolution {
    const nameKey = alnumKey(name);
    const reps = repsByChamber.get(chamber.toLowerCase().trim()) ?? [];
    const matches = reps.filter(
      (r) =>
        r.surnameKey.length >= SURNAME_MIN_GATE_LEN &&
        nameKey.includes(r.surnameKey),
    );
    if (matches.length > 1) return { kind: 'ambiguous' };
    if (matches.length === 1) {
      return {
        kind: 'match',
        repId: matches[0].id,
        surname: matches[0].surname,
      };
    }
    return { kind: 'unmatched' };
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

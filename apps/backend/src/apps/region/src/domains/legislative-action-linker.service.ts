/**
 * Legislative Action Linker
 *
 * V1 deterministic post-sync pass that mines `Minutes.rawText` and
 * produces `LegislativeAction` rows attributing presence rolls,
 * committee reports/hearings, amendments, engrossments/enrollments,
 * and resolutions to representatives, propositions, and committees.
 *
 * Each emitted action carries char-offset references back into the
 * source Minutes (`passageStart` / `passageEnd`) so citizen-facing
 * UIs can quote the verbatim passage in a "letter to my rep"
 * workflow. AI summarization + per-claim attribution is V2.
 *
 * Idempotent — safe to re-run after a Minutes ingest. Existing
 * action rows for a given Minutes are deleted before regeneration so
 * superseded revisions don't accumulate stale records.
 *
 * Issue #665.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';

interface LinkerCaches {
  /** lowercase last-name → rep ids, scoped per chamber. */
  repsByLastName: Map<string, Map<string, string[]>>;
  /** canonical proposition externalId (e.g., 'AB 1863') → proposition id. */
  propositionsByExternalId: Map<string, string>;
  /** chamber-scoped normalized committee name → committee id. */
  committeesByExternalId: Map<string, string>;
}

interface MinutesContext {
  id: string;
  body: string;
  date: Date;
  externalId: string;
  rawText: string;
  caches: LinkerCaches;
}

interface CandidateAction {
  actionType: string;
  rawSubject?: string;
  text?: string;
  position?: 'yes' | 'no' | 'abstain' | 'absent';
  passageStart: number;
  passageEnd: number;
  representativeId?: string;
  propositionId?: string;
  committeeId?: string;
}

const SURNAME_LINE_RE = /^[A-ZÀ-ſ][A-Za-zÀ-ſ.,\s'\-’]*$/;
const BILL_CITATION_RE =
  /(Assembly|ASSEMBLY|Senate|SENATE)\s+(Bill|BILL|Joint Resolution|JOINT RESOLUTION|Concurrent Resolution|CONCURRENT RESOLUTION|Constitutional Amendment|CONSTITUTIONAL AMENDMENT)\s+(?:No\.|NO\.)?\s*(\d+)/g;
const ROLLCALL_INTRO_RE = /^The following.*morning rollcall/im;
const SPEAKER_LINE_RE = /^Mr\.\s*Speaker\s*$/im;
const ABSENCE_GROUP_RE =
  /([^:.]+):\s*(?:Assembly\s+)?Members?\s+([^.]+?)(?:\.|$)/g;
const COMMITTEE_HEARING_RE =
  /Committee on\s+([^\n]+?)\nDate of Hearing:\s*([^\n]+)/g;
const AMENDMENT_ADOPTED_RE =
  /amendments proposed by the Committee on\s+([^\n]+?)\s+read and adopted/gi;
const ENGROSSED_RE = /Above\s+bill[s]?\s+correctly\s+engrossed/i;
const ENROLLED_RE = /Above\s+bill[s]?\s+correctly\s+enrolled/i;

@Injectable()
export class LegislativeActionLinkerService {
  private readonly logger = new Logger(LegislativeActionLinkerService.name);

  constructor(
    private readonly db: DbService,
    private readonly committeeLinker: LegislativeCommitteeLinkerService,
  ) {}

  /**
   * Re-link all active Minutes whose rawText hasn't been linked since
   * its last update. The simple "delete + re-insert" idempotency model
   * means we can run this on every Minutes ingest — expensive linking
   * doesn't happen for already-processed rows because the loop only
   * walks rows whose IDs are passed in.
   */
  async linkMinutes(minutesIds: string[]): Promise<{
    minutesProcessed: number;
    actionsCreated: number;
  }> {
    if (minutesIds.length === 0) {
      return { minutesProcessed: 0, actionsCreated: 0 };
    }

    const minutesRows = await this.db.minutes.findMany({
      where: { id: { in: minutesIds }, isActive: true },
    });

    if (minutesRows.length === 0) {
      return { minutesProcessed: 0, actionsCreated: 0 };
    }

    const caches = await this.loadCaches();
    let actionsCreated = 0;

    for (const row of minutesRows) {
      if (!row.rawText) {
        this.logger.warn(
          `Minutes ${row.externalId}: empty rawText, skipping linker`,
        );
        continue;
      }

      const ctx: MinutesContext = {
        id: row.id,
        body: row.body,
        date: row.date,
        externalId: row.externalId,
        rawText: row.rawText,
        caches,
      };

      const candidates = this.extractCandidates(ctx);
      const persisted = await this.persistActions(ctx, candidates);
      actionsCreated += persisted;
    }

    this.logger.log(
      `Linker complete: ${minutesRows.length} minutes processed, ${actionsCreated} actions created`,
    );

    return {
      minutesProcessed: minutesRows.length,
      actionsCreated,
    };
  }

  // ============================================
  // Cache construction
  // ============================================

  private async loadCaches(): Promise<LinkerCaches> {
    const [reps, propositions, committees] = await Promise.all([
      this.db.representative.findMany({
        where: { deletedAt: null },
        select: { id: true, lastName: true, chamber: true },
      }),
      this.db.proposition.findMany({
        where: { deletedAt: null },
        select: { id: true, externalId: true },
      }),
      this.db.legislativeCommittee.findMany({
        where: { deletedAt: null },
        select: { id: true, externalId: true },
      }),
    ]);

    const repsByLastName = new Map<string, Map<string, string[]>>();
    for (const rep of reps) {
      const chamber = rep.chamber;
      if (!chamber) continue;
      if (!repsByLastName.has(chamber)) {
        repsByLastName.set(chamber, new Map());
      }
      const ln = (rep.lastName ?? '').toLowerCase().trim();
      if (!ln) continue;
      const bucket = repsByLastName.get(chamber)!;
      const existing = bucket.get(ln) ?? [];
      existing.push(rep.id);
      bucket.set(ln, existing);
    }

    const propositionsByExternalId = new Map<string, string>();
    for (const p of propositions) {
      propositionsByExternalId.set(p.externalId, p.id);
    }

    const committeesByExternalId = new Map<string, string>();
    for (const c of committees) {
      committeesByExternalId.set(c.externalId, c.id);
    }

    return { repsByLastName, propositionsByExternalId, committeesByExternalId };
  }

  // ============================================
  // Candidate extraction
  // ============================================

  private extractCandidates(ctx: MinutesContext): CandidateAction[] {
    const out: CandidateAction[] = [];
    out.push(...this.extractPresence(ctx));
    out.push(...this.extractAbsences(ctx));
    out.push(...this.extractCommitteeHearings(ctx));
    out.push(...this.extractAmendments(ctx));
    out.push(...this.extractEngrossmentsAndEnrollments(ctx));
    return out;
  }

  /**
   * Presence rolls: bracket text between the rollcall intro line and
   * the line "Mr. Speaker" (which is implicitly present), emitting one
   * 'presence' (position='yes') per surname-shaped line in between.
   */
  private extractPresence(ctx: MinutesContext): CandidateAction[] {
    const intro = ROLLCALL_INTRO_RE.exec(ctx.rawText);
    if (!intro) return [];
    const tail = ctx.rawText.slice(intro.index);
    const speaker = SPEAKER_LINE_RE.exec(tail);
    if (!speaker) return [];
    const block = tail.slice(0, speaker.index);
    const blockStart = intro.index;

    const out: CandidateAction[] = [];
    let cursor = blockStart;
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      const start = cursor;
      const end = cursor + line.length + 1;
      cursor = end;
      if (!trimmed || !SURNAME_LINE_RE.test(trimmed)) continue;
      if (/morning rollcall/i.test(trimmed)) continue;

      const repId = this.resolveRep(ctx, trimmed);
      out.push({
        actionType: 'presence',
        position: 'yes',
        rawSubject: trimmed,
        passageStart: start,
        passageEnd: end,
        representativeId: repId,
      });
    }

    // The matched "Mr. Speaker" line is itself a presence entry.
    const speakerStart = blockStart + speaker.index;
    const speakerEnd = speakerStart + speaker[0].length;
    out.push({
      actionType: 'presence',
      position: 'yes',
      rawSubject: 'Mr. Speaker',
      passageStart: speakerStart,
      passageEnd: speakerEnd,
    });
    return out;
  }

  private extractAbsences(ctx: MinutesContext): CandidateAction[] {
    // Reset stateful regex
    ABSENCE_GROUP_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = ABSENCE_GROUP_RE.exec(ctx.rawText)) !== null) {
      const reason = m[1].trim();
      const namesBlob = m[2];
      const matchStart = m.index;
      const matchEnd = m.index + m[0].length;

      const names = this.splitAbsenceNames(namesBlob);
      for (const name of names) {
        if (!name) continue;
        const repId = this.resolveRep(ctx, name);
        out.push({
          actionType: 'presence',
          position: 'absent',
          rawSubject: name,
          text: this.truncate(`${reason}: ${name}`, 4000),
          passageStart: matchStart,
          passageEnd: matchEnd,
          representativeId: repId,
        });
      }
    }
    return out;
  }

  private splitAbsenceNames(blob: string): string[] {
    return blob
      .replaceAll(/\band\s+/gi, ',')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
  }

  private extractCommitteeHearings(ctx: MinutesContext): CandidateAction[] {
    COMMITTEE_HEARING_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = COMMITTEE_HEARING_RE.exec(ctx.rawText)) !== null) {
      const committeeName = m[1].trim();
      const hearingDate = m[2].trim();
      const committeeId = this.resolveCommittee(ctx, committeeName);
      out.push({
        actionType: 'committee_hearing',
        rawSubject: committeeName,
        text: this.truncate(
          `Committee on ${committeeName} — Date of Hearing: ${hearingDate}`,
          4000,
        ),
        passageStart: m.index,
        passageEnd: m.index + m[0].length,
        committeeId,
      });
    }
    return out;
  }

  private extractAmendments(ctx: MinutesContext): CandidateAction[] {
    AMENDMENT_ADOPTED_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = AMENDMENT_ADOPTED_RE.exec(ctx.rawText)) !== null) {
      const committeeName = m[1].trim();
      const committeeId = this.resolveCommittee(ctx, committeeName);
      out.push({
        actionType: 'amendment',
        rawSubject: `Committee on ${committeeName}`,
        text: this.truncate(this.sliceAround(ctx.rawText, m.index, 240), 4000),
        passageStart: m.index,
        passageEnd: m.index + m[0].length,
        committeeId,
      });
    }
    return out;
  }

  private extractEngrossmentsAndEnrollments(
    ctx: MinutesContext,
  ): CandidateAction[] {
    BILL_CITATION_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = BILL_CITATION_RE.exec(ctx.rawText)) !== null) {
      const canonical = this.normalizeBillCitation(m[1], m[2], m[3]);
      const propId = ctx.caches.propositionsByExternalId.get(canonical);
      const window = this.sliceAround(ctx.rawText, m.index, 240);
      let actionType: string | undefined;
      if (ENROLLED_RE.test(window)) {
        actionType = 'enrollment';
      } else if (ENGROSSED_RE.test(window)) {
        actionType = 'engrossment';
      }
      if (!actionType) continue;
      out.push({
        actionType,
        rawSubject: canonical,
        text: this.truncate(window, 4000),
        passageStart: m.index,
        passageEnd: m.index + m[0].length,
        propositionId: propId,
      });
    }
    return out;
  }

  private normalizeBillCitation(
    chamber: string,
    type: string,
    number: string,
  ): string {
    const c = /^assembly$/i.test(chamber) ? 'A' : 'S';
    let t = '';
    if (/^bill$/i.test(type)) t = 'B';
    else if (/^joint resolution$/i.test(type)) t = 'JR';
    else if (/^concurrent resolution$/i.test(type)) t = 'CR';
    else if (/^constitutional amendment$/i.test(type)) t = 'CA';
    return `${c}${t} ${number}`;
  }

  // ============================================
  // FK resolution
  // ============================================

  private resolveRep(ctx: MinutesContext, name: string): string | undefined {
    const surname = name.split(',')[0].trim().toLowerCase();
    if (!surname) return undefined;
    const bucket = ctx.caches.repsByLastName.get(ctx.body);
    const matches = bucket?.get(surname) ?? [];
    if (matches.length === 1) return matches[0];
    return undefined;
  }

  private resolveCommittee(
    ctx: MinutesContext,
    name: string,
  ): string | undefined {
    const ext = this.committeeLinker.externalIdFor(ctx.body, name);
    if (!ext) return undefined;
    return ctx.caches.committeesByExternalId.get(ext);
  }

  // ============================================
  // Persistence
  // ============================================

  private async persistActions(
    ctx: MinutesContext,
    candidates: CandidateAction[],
  ): Promise<number> {
    if (candidates.length === 0) {
      await this.db.legislativeAction.deleteMany({
        where: { minutesId: ctx.id },
      });
      return 0;
    }

    const records = candidates.map((c, i) => ({
      externalId: `${ctx.externalId}-${String(i + 1).padStart(4, '0')}`,
      minutesId: ctx.id,
      body: ctx.body,
      date: ctx.date,
      actionType: c.actionType,
      representativeId: c.representativeId ?? null,
      propositionId: c.propositionId ?? null,
      committeeId: c.committeeId ?? null,
      position: c.position ?? null,
      text: c.text ?? null,
      passageStart: c.passageStart,
      passageEnd: c.passageEnd,
      rawSubject: c.rawSubject ?? null,
    }));

    await this.db.$transaction([
      this.db.legislativeAction.deleteMany({ where: { minutesId: ctx.id } }),
      this.db.legislativeAction.createMany({ data: records }),
    ]);

    return records.length;
  }

  // ============================================
  // Helpers
  // ============================================

  private sliceAround(text: string, idx: number, halfWindow: number): string {
    const start = Math.max(0, idx - halfWindow);
    const end = Math.min(text.length, idx + halfWindow);
    return text.slice(start, end).trim();
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}

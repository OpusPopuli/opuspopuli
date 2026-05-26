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
  /** Two-level lookup: sessionYear ("2025-2026") → billNumber ("AB 1863")
   *  → bill id. Session-scoped because billNumber values are reused
   *  across CA legislative sessions (e.g., `AB 2` exists in 2023-2024
   *  AND 2025-2026 as distinct rows). Distinct from
   *  `propositionsByExternalId`: bills are the legislative-process
   *  records, propositions are the qualified-for-ballot records — a
   *  citation can resolve to one, both, or neither. See opuspopuli#666. */
  billsByBillNumber: Map<string, Map<string, string>>;
  /** chamber-scoped normalized committee name → committee id. */
  committeesByExternalId: Map<string, string>;
}

interface MinutesContext {
  id: string;
  body: string;
  date: Date;
  /** CA legislative session ("YYYY-YYYY") derived from {@link date}.
   *  Computed once per Minutes so bill-citation lookups stay scoped to
   *  the right session without recomputing on every match. */
  sessionYear: string;
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
  billId?: string;
  committeeId?: string;
}

/**
 * One contiguous section of a journal, anchored on a recognized
 * uppercase section header. `startOffset` / `endOffset` are
 * char-offsets into the parent rawText so per-extractor regex matches
 * can be re-anchored back to the document for passageStart/passageEnd.
 */
interface JournalSection {
  header: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Recognized section headers in CA Assembly daily journals. Matched
 * verbatim against lines (anchored, all-caps). Headers seen in real
 * journals but not extracted from (`PROCEEDINGS OF THE ASSEMBLY`,
 * `INTRODUCTION OF GUESTS`, `MESSAGES FROM THE GOVERNOR`,
 * `COMMUNICATIONS`, `INTRODUCTION AND REFERENCE OF BILLS`, etc.) are
 * still treated as section boundaries so unrelated text doesn't leak
 * into the extractors.
 */
const SECTION_HEADERS = new Set<string>([
  'ROLLCALL',
  'LEAVES OF ABSENCE FOR THE DAY',
  'ENGROSSMENT AND ENROLLMENT REPORTS',
  'RESOLUTIONS',
  "AUTHOR'S AMENDMENTS",
  'AUTHOR’S AMENDMENTS', // curly apostrophe variant
  'REPORTS OF STANDING COMMITTEES',
  'SECOND READING OF ASSEMBLY BILLS',
  'THIRD READING OF ASSEMBLY BILLS',
  // Recognized boundaries — not extracted from but used to bound others:
  'PROCEEDINGS OF THE ASSEMBLY',
  'IN ASSEMBLY',
  'INTRODUCTION OF GUESTS',
  'INTRODUCTION AND REFERENCE OF BILLS',
  'COMMUNICATIONS',
  'MESSAGES FROM THE GOVERNOR',
  'MESSAGES FROM THE SENATE',
  'MOTIONS AND RESOLUTIONS',
  'ROLLCALL VOTES',
  'PRESENTATION OF FLAG',
  'ADJOURNMENT',
  'PRAYER',
  'PLEDGE OF ALLEGIANCE',
]);

// Every regex below uses bounded quantifiers (`{n,m}` instead of `*`
// and `+`) and char classes that exclude `\n` where applicable, so
// the regex engine cannot backtrack past a line boundary or beyond a
// realistic per-token budget. This is defensive belt-and-braces
// against Sonar S5852 (super-linear runtime risk) — the inputs are
// already bounded by section-scoping in extractCandidates(), but
// bounded quantifiers also pass static analysis without an
// exception.

const SURNAME_LINE_RE = /^[A-ZÀ-ſ][A-Za-zÀ-ſ.,'\-’ ]{0,200}$/;
// Case-insensitive flag (`i`) eliminates the doubled UPPERCASE
// alternatives in the original pattern; bounded `\s{1,5}` between
// tokens replaces unbounded `\s+`. Number captured at `\d{1,6}` —
// CA Assembly bills max at ~3-4 digits, 6 is a defensive ceiling.
const BILL_CITATION_RE =
  /(Assembly|Senate)\s{1,5}(Bill|Joint Resolution|Concurrent Resolution|Constitutional Amendment)\s{1,5}(?:No\.\s{0,5})?(\d{1,6})/gi;
const ROLLCALL_INTRO_RE =
  /^The (?:following[^\n]{0,200}morning rollcall|rollcall was completed[^\n]{0,200}?\bnames)/im;
const SPEAKER_LINE_RE = /^Mr\.\s{0,5}Speaker\s{0,5}$/im;
/**
 * Absence groups within the LEAVES OF ABSENCE section. Format:
 *   <reason>: Assembly Member(s) <name1>, <name2>, ..., and <nameN>.
 *
 * Reason group `[^:.\n]{1,200}` excludes newlines + period + colon.
 * Names group `[^.\n\r]{1,1000}?` is bounded and non-greedy. The
 * length caps + char-class exclusions prevent the super-linear
 * backtracking Sonar flags (S5852) on unbounded `+?` chains —
 * defensive even though section-scoping already limits the input.
 */
const ABSENCE_GROUP_RE =
  /([^:.\n]{1,200}):\s{0,5}(?:Assembly\s{1,5})?Members?\s{1,5}((?:[^.\n]|\n(?!\s{0,10}\n)){1,1000}?)(?:\.|$)/g;
// Bounded `[^\n]{1,200}` instead of `(.+?)\s*$` — eliminates the
// non-greedy / trailing-whitespace backtracking pair that Sonar
// would flag on long lines. Committee names run < 100 chars in real
// journals; 200 is generous defensive ceiling.
const COMMITTEE_HEADER_RE = /^Committee on\s{1,5}([^\n]{1,200})$/m;
const HEARING_DATE_RE = /^Date of Hearing:\s{0,5}([^\n]{1,200})$/m;
const AMENDMENT_ADOPTED_RE =
  /amendments proposed by the Committee on\s{1,5}([^\n]{1,200}?)\s{1,5}read and adopted/gi;
// Real journal phrasing is "And reports the same correctly engrossed."
// (chief clerk's report) — NOT "Above bills correctly engrossed." which
// is a separate next-action sentence that follows. Match the chief
// clerk's verb regardless of preamble.
const ENGROSSED_RE = /correctly\s{1,5}engrossed/i;
const ENROLLED_RE = /correctly\s{1,5}enrolled/i;
/**
 * One newly-offered resolution. Source format:
 *   ASSEMBLY [CONCURRENT|JOINT] RESOLUTION NO. <n>—<introducer>. <subject>.
 * Capture groups: 1 = canonical resolution id phrase, 2 = introducer,
 * 3 = subject. The em-dash (U+2014), en-dash (U+2013), or ASCII '-'
 * are all accepted between the id and introducer.
 *
 * Quantifiers are bounded (introducer ≤ 200 chars, subject ≤ 500
 * chars) and char classes exclude `\n` so the engine can't backtrack
 * across line boundaries. Eliminates the super-linear-runtime risk
 * Sonar flags on unbounded `+?`/`.+?` chains (rule S5852).
 */
const RESOLUTION_LINE_RE =
  /^(ASSEMBLY (?:CONCURRENT |JOINT )?RESOLUTION NO\.\s{0,5}\d{1,6})[—–-]\s{0,5}([^.\n]{1,200})\.\s{0,5}([^\n]{1,500})$/m;

@Injectable()
export class LegislativeActionLinkerService {
  private readonly logger = new Logger(LegislativeActionLinkerService.name);

  constructor(
    private readonly db: DbService,
    private readonly committeeLinker: LegislativeCommitteeLinkerService,
  ) {}

  /**
   * Link the given Minutes ids. When `relinkAll` is true, re-runs over
   * every active Minutes for the body — useful after linker code
   * improvements to refresh actions without re-fetching PDFs.
   */
  async linkMinutes(
    minutesIds: string[],
  ): Promise<{ minutesProcessed: number; actionsCreated: number }> {
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
    // Canonical bill citations (e.g. "AB 1234") seen across all processed
    // minutes. Used to flag matching Bill rows for status re-check (#689).
    const citedBillNumbers = new Set<string>();

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
        sessionYear: this.deriveSessionYear(row.date),
        externalId: row.externalId,
        rawText: row.rawText,
        caches,
      };

      const candidates = this.extractCandidates(ctx);
      const persisted = await this.persistActions(ctx, candidates);
      actionsCreated += persisted;

      this.collectBillCitations(row.rawText, citedBillNumbers);
    }

    const flagged = await this.markBillsForStatusRecheck(citedBillNumbers);

    this.logger.log(
      `Linker complete: ${minutesRows.length} minutes processed, ${actionsCreated} actions created, ${flagged} bill(s) flagged for status re-check`,
    );

    return {
      minutesProcessed: minutesRows.length,
      actionsCreated,
    };
  }

  /**
   * Sweep raw journal text for canonical bill citations and accumulate them
   * in the provided set. Cheaper than re-running extractCandidates because
   * we only need the citation strings (not the surrounding context).
   */
  private collectBillCitations(text: string, into: Set<string>): void {
    BILL_CITATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BILL_CITATION_RE.exec(text)) !== null) {
      into.add(this.normalizeBillCitation(m[1], m[2], m[3]));
    }
  }

  /**
   * Batch-flag bills cited in newly-linked journals so the next bills sync
   * re-fetches their status pages. See #689 — closes the gap where a bill's
   * status changes (committee referral, floor vote) without its text-page
   * `sourcePublishedAt` updating, which would otherwise cause the existing
   * skip optimization to bypass it.
   *
   * Matches on `billNumber` alone (no `sessionYear` filter). This is
   * intentionally conservative — it may flag bills from prior sessions,
   * but the re-check itself is cheap and the lastActionDate comparison
   * will skip them when nothing actually changed.
   */
  private async markBillsForStatusRecheck(
    canonicals: Set<string>,
  ): Promise<number> {
    if (canonicals.size === 0) return 0;
    const result = await this.db.bill.updateMany({
      where: { billNumber: { in: Array.from(canonicals) } },
      data: { needsStatusRecheck: true },
    });
    return result.count;
  }

  /**
   * Re-link every active Minutes row. Used by the
   * `run-relink-minutes` admin script and could be exposed as an
   * admin GraphQL mutation later. Bypasses the watermark — operates
   * on whatever is already in the DB.
   */
  async relinkAll(): Promise<{
    minutesProcessed: number;
    actionsCreated: number;
  }> {
    const rows = await this.db.minutes.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return this.linkMinutes(rows.map((r) => r.id));
  }

  // ============================================
  // Cache construction
  // ============================================

  private async loadCaches(): Promise<LinkerCaches> {
    const [reps, propositions, bills, committees] = await Promise.all([
      this.db.representative.findMany({
        where: { deletedAt: null },
        select: { id: true, lastName: true, chamber: true },
      }),
      this.db.proposition.findMany({
        select: { id: true, externalId: true },
      }),
      this.db.bill.findMany({
        select: { id: true, billNumber: true, sessionYear: true },
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

    const billsByBillNumber = new Map<string, Map<string, string>>();
    for (const b of bills) {
      // billNumber is "AB 1234" / "SB 99" — same canonical form the
      // citation extractor produces. Session-scoped so e.g. "AB 2" in
      // the 2023-2024 session doesn't collide with "AB 2" in 2025-2026.
      // Single-region today; cross-region collisions would need a
      // regionId filter (see opuspopuli#731).
      let inner = billsByBillNumber.get(b.sessionYear);
      if (!inner) {
        inner = new Map<string, string>();
        billsByBillNumber.set(b.sessionYear, inner);
      }
      inner.set(b.billNumber, b.id);
    }

    const committeesByExternalId = new Map<string, string>();
    for (const c of committees) {
      committeesByExternalId.set(c.externalId, c.id);
    }

    return {
      repsByLastName,
      propositionsByExternalId,
      billsByBillNumber,
      committeesByExternalId,
    };
  }

  // ============================================
  // Section splitter
  // ============================================

  /**
   * Split rawText into named sections by recognizing all-caps section
   * headers (verbatim from CA Assembly journal layout). Each section's
   * `text` is bounded by its header and the next recognized header,
   * with offsets preserved so per-extractor matches can be projected
   * back into the parent document for passage offsets.
   *
   * Headers seen multiple times in one document (e.g. multiple
   * "ROLLCALL" appearances on different session days) all get
   * collected and dispatched independently.
   */
  private splitSections(rawText: string): JournalSection[] {
    const sections: JournalSection[] = [];
    const lineStarts: number[] = [0];
    for (let i = 0; i < rawText.length; i++) {
      if (rawText[i] === '\n') lineStarts.push(i + 1);
    }

    const boundaries: { offset: number; header: string }[] = [];
    for (const start of lineStarts) {
      const lineEnd = rawText.indexOf('\n', start);
      const line = rawText
        .slice(start, lineEnd === -1 ? rawText.length : lineEnd)
        .trim();
      if (!line) continue;
      // Quick reject: must be all-caps-ish (allow digits, punctuation).
      if (/[a-z]/.test(line)) continue;
      if (SECTION_HEADERS.has(line)) {
        boundaries.push({ offset: start, header: line });
      }
    }

    for (let i = 0; i < boundaries.length; i++) {
      const cur = boundaries[i];
      const next = boundaries[i + 1];
      const startOffset = cur.offset;
      const endOffset = next ? next.offset : rawText.length;
      sections.push({
        header: cur.header,
        text: rawText.slice(startOffset, endOffset),
        startOffset,
        endOffset,
      });
    }

    return sections;
  }

  // ============================================
  // Candidate extraction
  // ============================================

  private extractCandidates(ctx: MinutesContext): CandidateAction[] {
    const out: CandidateAction[] = [];
    const sections = this.splitSections(ctx.rawText);

    for (const section of sections) {
      switch (section.header) {
        case 'ROLLCALL':
          out.push(...this.extractPresence(ctx, section));
          break;
        case 'LEAVES OF ABSENCE FOR THE DAY':
          out.push(...this.extractAbsences(ctx, section));
          break;
        case 'REPORTS OF STANDING COMMITTEES':
          out.push(...this.extractCommitteeReports(ctx, section));
          break;
        case "AUTHOR'S AMENDMENTS":
        case 'AUTHOR’S AMENDMENTS':
          out.push(...this.extractAuthorsAmendments(ctx, section));
          break;
        case 'SECOND READING OF ASSEMBLY BILLS':
        case 'THIRD READING OF ASSEMBLY BILLS':
          out.push(...this.extractReadingAmendments(ctx, section));
          break;
        case 'ENGROSSMENT AND ENROLLMENT REPORTS':
          out.push(...this.extractEngrossmentsAndEnrollments(ctx, section));
          break;
        case 'RESOLUTIONS':
          out.push(...this.extractResolutions(ctx, section));
          break;
        // Other recognized headers (PROCEEDINGS, COMMUNICATIONS, etc.)
        // bound the others but yield no actions in V1.
      }
    }

    return out;
  }

  /**
   * Presence rolls: bracket text between the rollcall intro line and
   * the line "Mr. Speaker" (which is implicitly present), emitting one
   * 'presence' (position='yes') per surname-shaped line in between.
   */
  private extractPresence(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    const intro = ROLLCALL_INTRO_RE.exec(section.text);
    if (!intro) return [];
    const tail = section.text.slice(intro.index);
    const speaker = SPEAKER_LINE_RE.exec(tail);
    if (!speaker) return [];
    const block = tail.slice(0, speaker.index);
    const blockStart = section.startOffset + intro.index;

    const out: CandidateAction[] = [];
    let cursor = blockStart;
    for (const line of block.split('\n')) {
      const lineLength = line.length + 1; // +1 for the consumed '\n'
      const start = cursor;
      const end = cursor + lineLength;
      cursor = end;

      // Some rollcall variants use multi-column layouts, e.g.:
      //   "Addis   Davies  Johnson         Rogers"
      // Split on multi-space gaps to recover individual surnames.
      const cells = line.split(/\s{2,}/).map((c) => c.trim());
      let cellOffset = start;
      for (const cell of cells) {
        if (!cell || !SURNAME_LINE_RE.test(cell)) {
          cellOffset += cell.length + 1;
          continue;
        }
        if (/morning rollcall|rollcall|the following/i.test(cell)) {
          cellOffset += cell.length + 1;
          continue;
        }
        const repId = this.resolveRep(ctx, cell);
        out.push({
          actionType: 'presence',
          position: 'yes',
          rawSubject: cell,
          passageStart: cellOffset,
          passageEnd: Math.min(cellOffset + cell.length, end),
          representativeId: repId,
        });
        cellOffset += cell.length + 1;
      }
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

  /**
   * Absences: only run within the LEAVES OF ABSENCE FOR THE DAY
   * section so unrelated `<text>: Assembly Member <name>` constructs
   * elsewhere (vote-change reports, motions) don't false-positive.
   */
  private extractAbsences(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    ABSENCE_GROUP_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = ABSENCE_GROUP_RE.exec(section.text)) !== null) {
      const reason = m[1].trim();
      const namesBlob = m[2];
      const matchStart = section.startOffset + m.index;
      const matchEnd = section.startOffset + m.index + m[0].length;

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
      .map((n) => n.replaceAll(/\s+/g, ' ').trim())
      .filter((n) => n.length > 0);
  }

  /**
   * REPORTS OF STANDING COMMITTEES has a repeating block shape:
   *
   *   Committee on <name>
   *   Date of Hearing: <date>
   *   Mr. Speaker: Your Committee on <name> reports:
   *   <bill1>
   *   <bill2>
   *   ...
   *   With the recommendation: <verdict>.
   *   <CHAIR_SURNAME>, Chair
   *   Above bill[s] <disposition>.
   *
   * Emits one `committee_hearing` per (committee, hearing date) and
   * one `committee_report` per bill, both with the committee FK.
   */
  private extractCommitteeReports(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    const out: CandidateAction[] = [];

    for (const {
      blockText,
      blockOffset,
      committeeName,
      committeeId,
    } of this.committeeBlocksForSection(ctx, section)) {
      const hearingMatch = HEARING_DATE_RE.exec(blockText);
      const hearingDate = hearingMatch?.[1]?.trim();
      // Bounded char class + length cap — no nested quantifiers, no
      // backtracking. Recommendations in real journals run to a few
      // hundred chars at most; cap at 800 as a defensive ceiling.
      const recommendationMatch =
        /With the recommendation:\s{0,5}([^\n]{1,800}?\.)/i.exec(blockText);
      const recommendation = recommendationMatch?.[1]?.trim();

      // Hearing action — one per block when we have both committee + date.
      if (committeeName && hearingDate) {
        const matchOffset = hearingMatch ? hearingMatch.index : 0;
        out.push({
          actionType: 'committee_hearing',
          rawSubject: committeeName,
          text: this.truncate(
            `Committee on ${committeeName} — Date of Hearing: ${hearingDate}`,
            4000,
          ),
          passageStart: blockOffset + matchOffset,
          passageEnd:
            blockOffset +
            matchOffset +
            (hearingMatch?.[0]?.length ?? committeeName.length),
          committeeId,
        });
      }

      // Per-bill committee_report actions.
      for (const cite of this.billCitationsInBlock(
        blockText,
        blockOffset,
        ctx.caches,
        ctx.sessionYear,
      )) {
        out.push({
          actionType: 'committee_report',
          rawSubject: cite.canonical,
          text: this.truncate(
            recommendation
              ? `${cite.canonical}: ${recommendation}`
              : `${cite.canonical}: reported by Committee on ${committeeName ?? '?'}.`,
            4000,
          ),
          passageStart: cite.passageStart,
          passageEnd: cite.passageEnd,
          committeeId,
          propositionId: cite.propId,
          billId: cite.billId,
        });
      }
    }

    return out;
  }

  /**
   * AUTHOR'S AMENDMENTS — repeating "Committee on X / Mr. Speaker: ...
   * / <bill> / With author's amendments..." blocks.
   */
  private extractAuthorsAmendments(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    const out: CandidateAction[] = [];

    for (const {
      blockText,
      blockOffset,
      committeeName,
      committeeId,
    } of this.committeeBlocksForSection(ctx, section)) {
      if (!committeeName) continue;

      for (const cite of this.billCitationsInBlock(
        blockText,
        blockOffset,
        ctx.caches,
        ctx.sessionYear,
      )) {
        out.push({
          actionType: 'amendment',
          rawSubject: cite.canonical,
          text: this.truncate(
            `${cite.canonical}: author's amendments adopted in Committee on ${committeeName}.`,
            4000,
          ),
          passageStart: cite.passageStart,
          passageEnd: cite.passageEnd,
          committeeId,
          propositionId: cite.propId,
          billId: cite.billId,
        });
      }
    }
    return out;
  }

  /**
   * SECOND/THIRD READING OF ASSEMBLY BILLS — per-bill blocks where
   * "amendments proposed by the Committee on X read and adopted"
   * yields one `amendment` action per bill where the floor adopts a
   * committee amendment.
   */
  private extractReadingAmendments(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    AMENDMENT_ADOPTED_RE.lastIndex = 0;
    const out: CandidateAction[] = [];
    let m: RegExpExecArray | null;
    while ((m = AMENDMENT_ADOPTED_RE.exec(section.text)) !== null) {
      const committeeName = m[1].trim();
      const committeeId = this.resolveCommittee(ctx, committeeName);

      // Find the nearest preceding bill citation to attribute this
      // amendment to. Scan backward up to ~600 chars.
      const lookback = Math.max(0, m.index - 600);
      const window = section.text.slice(lookback, m.index);
      const bills = this.lastBillCitation(window, ctx.caches, ctx.sessionYear);

      out.push({
        actionType: 'amendment',
        rawSubject: bills?.canonical ?? `Committee on ${committeeName}`,
        text: this.truncate(
          bills
            ? `${bills.canonical}: amendments by Committee on ${committeeName} read and adopted.`
            : `Committee on ${committeeName} amendments read and adopted.`,
          4000,
        ),
        passageStart: section.startOffset + m.index,
        passageEnd: section.startOffset + m.index + m[0].length,
        committeeId,
        propositionId: bills?.propId,
        billId: bills?.billId,
      });
    }
    return out;
  }

  /**
   * ENGROSSMENT AND ENROLLMENT REPORTS — block-scoped on "Mr. Speaker:"
   * intro lines. Each block has N bill citations followed by ONE
   * disposition line (`Above bill[s] correctly engrossed/enrolled.`).
   * One action per bill per block, type from the block's disposition.
   */
  private extractEngrossmentsAndEnrollments(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    const out: CandidateAction[] = [];
    const blocks = this.splitOnLookahead(
      section.text,
      /^\s{0,10}Mr\.\s{0,5}Speaker:/m,
    );

    for (const block of blocks) {
      const blockOffset = section.startOffset + block.startInParent;
      let actionType: 'engrossment' | 'enrollment' | undefined;
      if (ENROLLED_RE.test(block.text)) actionType = 'enrollment';
      else if (ENGROSSED_RE.test(block.text)) actionType = 'engrossment';
      if (!actionType) continue;

      for (const cite of this.billCitationsInBlock(
        block.text,
        blockOffset,
        ctx.caches,
        ctx.sessionYear,
      )) {
        out.push({
          actionType,
          rawSubject: cite.canonical,
          text: this.truncate(
            `${cite.canonical}: Chief Clerk reports ${actionType === 'enrollment' ? 'enrolled' : 'engrossed'}.`,
            4000,
          ),
          passageStart: cite.passageStart,
          passageEnd: cite.passageEnd,
          propositionId: cite.propId,
          billId: cite.billId,
        });
      }
    }
    return out;
  }

  /**
   * RESOLUTIONS section — one resolution per matching line.
   */
  private extractResolutions(
    ctx: MinutesContext,
    section: JournalSection,
  ): CandidateAction[] {
    const out: CandidateAction[] = [];
    // Iterate line-by-line so passage offsets are precise.
    const re = new RegExp(RESOLUTION_LINE_RE.source, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(section.text)) !== null) {
      const idPhrase = m[1].trim();
      const introducer = m[2].trim();
      const subject = m[3].trim();
      const canonical = this.normalizeResolutionId(idPhrase);
      const propId = canonical
        ? ctx.caches.propositionsByExternalId.get(canonical)
        : undefined;
      const billId = canonical
        ? this.resolveBillId(ctx.caches, canonical, ctx.sessionYear)
        : undefined;

      out.push({
        actionType: 'resolution',
        rawSubject: canonical ?? idPhrase,
        text: this.truncate(`${introducer}: ${subject}`, 4000),
        passageStart: section.startOffset + m.index,
        passageEnd: section.startOffset + m.index + m[0].length,
        propositionId: propId,
        billId,
      });
    }
    return out;
  }

  // ============================================
  // Bill-citation normalization
  // ============================================

  /**
   * Iterate all bill citations in a text block, returning normalized tuples.
   * Centralises the BILL_CITATION_RE reset + exec loop that appears in
   * multiple extractXxx methods.
   */
  private billCitationsInBlock(
    blockText: string,
    blockOffset: number,
    caches: LinkerCaches,
    sessionYear: string,
  ): Array<{
    canonical: string;
    propId: string | undefined;
    billId: string | undefined;
    passageStart: number;
    passageEnd: number;
  }> {
    BILL_CITATION_RE.lastIndex = 0;
    const results: Array<{
      canonical: string;
      propId: string | undefined;
      billId: string | undefined;
      passageStart: number;
      passageEnd: number;
    }> = [];
    let m: RegExpExecArray | null;
    while ((m = BILL_CITATION_RE.exec(blockText)) !== null) {
      const canonical = this.normalizeBillCitation(m[1], m[2], m[3]);
      results.push({
        canonical,
        propId: caches.propositionsByExternalId.get(canonical),
        billId: this.resolveBillId(caches, canonical, sessionYear),
        passageStart: blockOffset + m.index,
        passageEnd: blockOffset + m.index + m[0].length,
      });
    }
    return results;
  }

  /**
   * Derive the CA legislative sessionYear ("2025-2026") that contains
   * the given date. CA sessions are 2-year cycles starting in odd
   * years — Jan 2025 through Nov 2026 is the "2025-2026" session.
   * Used to scope bill-citation resolution so we don't mis-link an
   * action to the same billNumber from a prior session.
   */
  private deriveSessionYear(date: Date): string {
    const y = date.getUTCFullYear();
    const start = y % 2 === 1 ? y : y - 1;
    return `${start}-${start + 1}`;
  }

  /** Session-scoped billNumber → billId lookup. */
  private resolveBillId(
    caches: LinkerCaches,
    canonical: string,
    sessionYear: string,
  ): string | undefined {
    return caches.billsByBillNumber.get(sessionYear)?.get(canonical);
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

  private normalizeResolutionId(phrase: string): string | undefined {
    const m =
      /ASSEMBLY (CONCURRENT |JOINT )?RESOLUTION NO\.\s{0,5}(\d{1,6})/.exec(
        phrase,
      );
    if (!m) return undefined;
    const kind = m[1]?.trim();
    let prefix = 'AR';
    if (kind === 'CONCURRENT') prefix = 'ACR';
    else if (kind === 'JOINT') prefix = 'AJR';
    return `${prefix} ${m[2]}`;
  }

  private lastBillCitation(
    window: string,
    caches: LinkerCaches,
    sessionYear: string,
  ): { canonical: string; propId?: string; billId?: string } | undefined {
    BILL_CITATION_RE.lastIndex = 0;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = BILL_CITATION_RE.exec(window)) !== null) {
      last = m;
    }
    if (!last) return undefined;
    const canonical = this.normalizeBillCitation(last[1], last[2], last[3]);
    return {
      canonical,
      propId: caches.propositionsByExternalId.get(canonical),
      billId: this.resolveBillId(caches, canonical, sessionYear),
    };
  }

  // ============================================
  // FK resolution
  // ============================================

  /**
   * Resolve a presence/absence subject to a representative id.
   * Strategy (single-match conservative — V1 leaves multi-matches null):
   *   1. Split on `,` and try the first token as surname (handles
   *      "Rodriguez, M.").
   *   2. If that doesn't match a single rep, fall back to the LAST
   *      whitespace-separated token (handles "Celeste Rodriguez").
   *   3. Multi-match ambiguity → null + log a warning so V2 work can
   *      add disambiguation (district, first-initial).
   */
  private resolveRep(ctx: MinutesContext, name: string): string | undefined {
    const bucket = ctx.caches.repsByLastName.get(ctx.body);
    if (!bucket) return undefined;

    const commaToken = name.split(',')[0].trim().toLowerCase();
    if (commaToken) {
      const matches = bucket.get(commaToken) ?? [];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return undefined;
    }

    // Fallback: last whitespace token (First Last → Last).
    const wsTokens = name.replaceAll(/[,.]/g, '').trim().split(/\s+/);
    if (wsTokens.length > 1) {
      const last = wsTokens[wsTokens.length - 1].toLowerCase();
      if (last && last !== commaToken) {
        const matches = bucket.get(last) ?? [];
        if (matches.length === 1) return matches[0];
      }
    }
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

    // Cross-source dedup: the same atomic action can appear in both a
    // daily journal AND the week's history (opuspopuli#666). Filter out
    // candidates whose (billId, date, actionType, position, representativeId)
    // tuple already exists in a *different* Minutes row for this region.
    const filtered = await this.dedupAgainstPriorMinutes(ctx, candidates);

    const records = filtered.map((c, i) => ({
      externalId: `${ctx.externalId}-${String(i + 1).padStart(4, '0')}`,
      minutesId: ctx.id,
      body: ctx.body,
      date: ctx.date,
      actionType: c.actionType,
      representativeId: c.representativeId ?? null,
      propositionId: c.propositionId ?? null,
      billId: c.billId ?? null,
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

  /**
   * Drop candidates that duplicate actions already linked to a different
   * Minutes row. The same atomic event (e.g. "AB 440 referred to Judiciary
   * 5/3") appears in both the day-of journal and the week's history; we
   * want one row, not two.
   *
   * Dedup key: (billId|propositionId, date, actionType, position, representativeId).
   * Actions without a billId/propositionId anchor (e.g. presence rolls)
   * are bypassed — they're inherently per-Minutes and not duplicated
   * across sources.
   */
  private async dedupAgainstPriorMinutes(
    ctx: MinutesContext,
    candidates: CandidateAction[],
  ): Promise<CandidateAction[]> {
    const tupleKey = (
      anchor: string,
      actionType: string,
      position?: string | null,
      representativeId?: string | null,
    ): string =>
      `${anchor}|${actionType}|${position ?? ''}|${representativeId ?? ''}`;

    // Collect distinct anchored candidates so we can do ONE Prisma read.
    const anchored = candidates.filter(
      (c) => c.billId != null || c.propositionId != null,
    );
    if (anchored.length === 0) return candidates;

    const billIds = new Set<string>();
    const propIds = new Set<string>();
    for (const c of anchored) {
      if (c.billId) billIds.add(c.billId);
      else if (c.propositionId) propIds.add(c.propositionId);
    }

    const anchorClauses: Array<
      { billId: { in: string[] } } | { propositionId: { in: string[] } }
    > = [];
    if (billIds.size > 0) {
      anchorClauses.push({ billId: { in: Array.from(billIds) } });
    }
    if (propIds.size > 0) {
      anchorClauses.push({ propositionId: { in: Array.from(propIds) } });
    }

    const existing = await this.db.legislativeAction.findMany({
      where: {
        date: ctx.date,
        minutesId: { not: ctx.id },
        OR: anchorClauses,
      },
      select: {
        billId: true,
        propositionId: true,
        actionType: true,
        position: true,
        representativeId: true,
      },
    });

    const seen = new Set<string>();
    for (const row of existing) {
      const anchor = row.billId ?? row.propositionId;
      if (!anchor) continue;
      seen.add(
        tupleKey(anchor, row.actionType, row.position, row.representativeId),
      );
    }

    let dropped = 0;
    const out = candidates.filter((c) => {
      const anchor = c.billId ?? c.propositionId;
      if (!anchor) return true; // un-anchored events stay (presence rolls, etc.)
      const key = tupleKey(
        anchor,
        c.actionType,
        c.position,
        c.representativeId,
      );
      if (seen.has(key)) {
        dropped++;
        return false;
      }
      // Mark intra-batch duplicates too: if two candidates in this single
      // Minutes share the tuple, keep only the first.
      seen.add(key);
      return true;
    });
    if (dropped > 0) {
      this.logger.log(
        `Linker dedup: dropped ${dropped} duplicate action(s) already present in another Minutes for ${ctx.externalId}`,
      );
    }
    return out;
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Split a journal section into "Committee on X" blocks and resolve the
   * committee name + document offset for each block. Used by both
   * `extractCommitteeReports` and `extractAuthorsAmendments` to avoid
   * duplicating the split + header-parse setup.
   */
  private committeeBlocksForSection(
    ctx: MinutesContext,
    section: JournalSection,
  ): Array<{
    blockText: string;
    blockOffset: number;
    committeeName: string | undefined;
    committeeId: string | undefined;
  }> {
    const blocks = this.splitOnLookahead(section.text, /^Committee on\s{1,5}/m);
    return blocks.map((block) => {
      const blockOffset = section.startOffset + block.startInParent;
      const cmtMatch = COMMITTEE_HEADER_RE.exec(block.text);
      const committeeName = cmtMatch?.[1]?.trim();
      const committeeId = committeeName
        ? this.resolveCommittee(ctx, committeeName)
        : undefined;
      return { blockText: block.text, blockOffset, committeeName, committeeId };
    });
  }

  /**
   * Split text on a regex lookahead, preserving the offset of each
   * resulting block in the parent. The first chunk (before any
   * lookahead match) is dropped — extractors only care about
   * blocks beginning at a recognized boundary.
   */
  private splitOnLookahead(
    text: string,
    boundaryRe: RegExp,
  ): { text: string; startInParent: number }[] {
    const out: { text: string; startInParent: number }[] = [];
    const re = new RegExp(boundaryRe.source, boundaryRe.flags + 'g');
    const starts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      starts.push(m.index);
      // Avoid zero-length match infinite loops.
      if (m[0].length === 0) re.lastIndex++;
    }
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = starts[i + 1] ?? text.length;
      out.push({ text: text.slice(start, end), startInParent: start });
    }
    return out;
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}

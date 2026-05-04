/**
 * Region Provider Types and Interfaces
 *
 * Strategy Pattern for region-specific data providers.
 * Supports swapping between different region implementations (e.g., California, Texas).
 * Forks implement their own provider to fetch data from their region's sources.
 */

/**
 * Supported data types for region content
 */
export enum DataType {
  PROPOSITIONS = "propositions",
  MEETINGS = "meetings",
  REPRESENTATIVES = "representatives",
  CAMPAIGN_FINANCE = "campaign_finance",
  LOBBYING = "lobbying",
  /// Per-action records from legislative daily journals (votes, motions,
  /// amendments, committee reports, presence). Issue #665.
  LEGISLATIVE_ACTIONS = "legislative_actions",
}

/**
 * Proposition status values
 */
export enum PropositionStatus {
  PENDING = "pending",
  PASSED = "passed",
  FAILED = "failed",
  WITHDRAWN = "withdrawn",
}

/**
 * Region information and configuration
 */
export interface RegionInfo {
  id: string;
  name: string;
  description: string;
  timezone: string;
  dataSourceUrls?: string[];
}

/**
 * A physical office location (Capitol or district)
 */
export interface Office {
  name: string;
  address?: string;
  phone?: string;
  fax?: string;
}

/**
 * Contact information for representatives
 */
export interface ContactInfo {
  email?: string;
  website?: string;
  offices?: Office[];
}

/**
 * AI-segmented section of a proposition's fullText — a ToC anchor with
 * character-offset bounds into the source. Empty when analysis hasn't run.
 */
export interface PropositionAnalysisSection {
  heading: string;
  /** Inclusive char offset into Proposition.fullText where this section starts. */
  startOffset: number;
  /** Exclusive char offset where the section ends. */
  endOffset: number;
}

/**
 * A single AI-derived claim about the proposition with a citation back
 * into the source text. Used by ClaimAttribution footnotes to scroll
 * the reader from the analysis to the supporting passage.
 */
export interface PropositionAnalysisClaim {
  /** The plain-language claim itself (appears as a footnote target). */
  claim: string;
  /** Which analysis field the claim backs: 'keyProvisions' | 'fiscalImpact' | 'yesOutcome' | 'noOutcome' | 'existingCurrent' | 'existingProposed' | 'summary'. */
  field: string;
  /** Inclusive char offset into fullText where the supporting passage starts. */
  sourceStart: number;
  /** Exclusive char offset where the supporting passage ends. */
  sourceEnd: number;
  confidence?: "high" | "medium" | "low";
}

/**
 * Current-law vs. proposed-change comparison for a ballot measure.
 */
export interface PropositionExistingVsProposed {
  current: string;
  proposed: string;
}

/**
 * Proposition/ballot measure data
 */
export interface Proposition {
  externalId: string;
  title: string;
  summary: string;
  fullText?: string;
  status: PropositionStatus;
  electionDate?: Date;
  sourceUrl?: string;

  /** AI-generated plain-language one-liner. */
  analysisSummary?: string;
  /** "This would..." bullets. */
  keyProvisions?: string[];
  fiscalImpact?: string;
  /** What a yes vote concretely means. */
  yesOutcome?: string;
  /** What a no vote concretely means. */
  noOutcome?: string;
  existingVsProposed?: PropositionExistingVsProposed;
  analysisSections?: PropositionAnalysisSection[];
  analysisClaims?: PropositionAnalysisClaim[];
  /** 'ai-generated' | 'manual' — reserved for future editorial override. */
  analysisSource?: "ai-generated" | "manual";
  /** Prompt hash from PromptServiceResponse — used to detect stale analyses. */
  analysisPromptHash?: string;
  analysisGeneratedAt?: Date;
}

/**
 * Legislative meeting data
 */
export interface Meeting {
  externalId: string;
  title: string;
  body: string;
  scheduledAt: Date;
  location?: string;
  agendaUrl?: string;
  videoUrl?: string;
  minutes?: string;
}

/**
 * A legislative committee assignment for a representative
 */
export interface CommitteeAssignment {
  name: string;
  role?: string;
  url?: string;
}

/**
 * Provenance of a representative's bio text.
 * - 'scraped': extracted from an official source (e.g., Senate website)
 * - 'ai-generated': produced by the LLM from structured public record data
 */
export type BioSource = "scraped" | "ai-generated";

/**
 * Per-sentence attribution for an AI-generated biography. Populated
 * when the LLM returns its claim breakdown alongside the bio text.
 * See #602.
 */
export interface BioClaim {
  /** Verbatim sentence from the bio this claim describes. */
  sentence: string;
  /** Where the fact came from. */
  origin: "source" | "training";
  /**
   * For origin="source": dot-path in the source data (e.g., "committees[0].name"). null otherwise.
   */
  sourceField?: string | null;
  /**
   * For origin="training": short phrase describing the kind of source
   * the fact is drawn from (e.g., "official legislative bio",
   * "press coverage of 2022 election"). null for source-origin claims.
   * Advisory hint, not a verified citation.
   */
  sourceHint?: string | null;
  /** LLM's self-reported confidence. */
  confidence?: "high" | "medium";
}

/**
 * Elected representative data
 */
export interface Representative {
  externalId: string;
  name: string;
  chamber: string;
  district: string;
  party: string;
  photoUrl?: string;
  contactInfo?: ContactInfo;
  committees?: CommitteeAssignment[];
  committeesSummary?: string;
  bio?: string;
  bioSource?: BioSource;
  bioClaims?: BioClaim[];
}

// ============================================
// MEETING MINUTES + LEGISLATIVE ACTIONS (issue #665)
// ============================================

/**
 * A meeting-minutes / journal document. The canonical PDF that records
 * what happened in a chamber session or committee hearing — daily
 * journals, committee hearing minutes, etc.
 *
 * V1 stores the document as opaque text + audit metadata at ingest
 * time; downstream passes (the legislative-action linker for V1, AI
 * summarization for V2) mine `rawText` to produce structured records.
 *
 * `committeeId` is set when the document is single-committee minutes;
 * null for chamber-wide daily journals. `meetingId` is set when the
 * document corresponds to a calendared meeting (most chamber-wide
 * daily journals leave it null).
 *
 * Revision handling: when the clerk re-publishes the same session
 * day's PDF (e.g. `adj042826_r1.pdf`), it lands as a new row with
 * `revisionSeq=1` and `isActive=true`; the original's `isActive` is
 * flipped to false.
 */
export interface Minutes {
  externalId: string;
  /** "Assembly" | "Senate" — V1 is CA Assembly only. */
  body: string;
  date: Date;
  /** 0 for the original publication, 1+ for revisions in publication order. */
  revisionSeq: number;
  /** True for the canonical-current version. */
  isActive: boolean;
  /** Set when the document is single-committee minutes. Null for chamber-wide daily journals. */
  committeeId?: string;
  /** Set when the document corresponds to a calendared meeting. */
  meetingId?: string;
  pageCount?: number;
  sourceUrl: string;
  /** Full pdf-parse output. Capped ~256kB at write time. */
  rawText?: string;
  /** V2 — AI-generated plain-language summary. */
  summary?: string;
  /** V2 — per-claim attribution into rawText for citizen-facing
   *  "letter to representative with quote" features. Mirrors the
   *  PropositionAnalysisClaim shape (sourceStart/sourceEnd offsets). */
  summaryClaims?: PropositionAnalysisClaim[];
  parsedAt?: Date;
}

/**
 * Action types extracted from a Minutes document.
 */
export type LegislativeActionType =
  /** Roll-call presence on the morning rollcall. */
  | "presence"
  /**
   * A scheduled or recorded committee hearing referenced in the
   * minutes (e.g. "Committee on Public Safety / Date of Hearing:
   * April 21, 2026"). Has `committeeId` set; may have `propositionId`
   * for hearings on a specific measure.
   */
  | "committee_hearing"
  /**
   * Committee reporting back on a bill out of hearing — typically a
   * "do pass" / "do pass as amended" / "hold" verdict. Distinct from
   * `committee_hearing` (the scheduled meeting) — a hearing produces
   * zero or more reports.
   */
  | "committee_report"
  | "amendment"
  | "engrossment"
  | "enrollment"
  | "resolution"
  /** V2 — per-rep-per-bill vote tables */
  | "vote"
  /** V2 — floor speech text + summarization */
  | "speech";

export type LegislativeVotePosition = "yes" | "no" | "abstain" | "absent";

/**
 * One discrete legislative action extracted from a Minutes document.
 *
 * `passageStart` / `passageEnd` are character offsets into the parent
 * Minutes' `rawText`. Citizens building a "letter to my rep" with a
 * quoted action use these offsets to pull the verbatim passage out of
 * the source. `text` is the already-extracted excerpt (denormalized for
 * query performance); offsets let the UI re-anchor the quote in
 * context.
 *
 * `body` and `date` are denormalized from the parent Minutes so the
 * canonical "rep activity feed" / "bill history" / "committee history"
 * queries don't require a JOIN to filter by date.
 */
export interface LegislativeAction {
  externalId: string;
  /**
   * Parent Minutes database id. Set after the Minutes row is inserted —
   * undefined in fetcher output. The fetcher returns actions nested
   * inside `MinutesWithActions` so the parent→child relationship is
   * preserved without this field.
   */
  minutesId?: string;
  /** "Assembly" | "Senate" — denormalized from minutes. */
  body: string;
  /** Denormalized from minutes. */
  date: Date;
  actionType: LegislativeActionType;
  /** Set by the linker. Null when the linker can't resolve to a known rep. */
  representativeId?: string;
  /** Set by the linker. Null when the bill isn't yet a qualified proposition. */
  propositionId?: string;
  /** Set by the linker. Null for non-committee actions. */
  committeeId?: string;
  /** Vote-only. Null for non-vote actions in V1. */
  position?: LegislativeVotePosition;
  /** Verbatim source excerpt. Truncate at 4kB at write time. */
  text?: string;
  /** V2 — AI-generated summary for long-form actions. */
  summary?: string;
  /** Inclusive char offset into the parent Minutes' rawText where the
   *  action's source passage begins. */
  passageStart?: number;
  /** Exclusive char offset into the parent Minutes' rawText where the
   *  action's source passage ends. */
  passageEnd?: number;
  /** Page within the parent minutes document. */
  sourcePage?: number;
  /** Pre-link reference text. Surname / "Assembly Bill No. N" / committee name. */
  rawSubject?: string;
}

/**
 * Fetcher output shape — a Minutes record bundled with any actions
 * already extracted at fetch time. V1 fetchers return Minutes only
 * (empty `actions`); the backend linker fills in actions in a
 * downstream pass after the Minutes row has a database id.
 *
 * Used as the `IRegionProvider.fetchLegislativeActions()` return type
 * so the parent→children relationship is explicit through the pipeline
 * boundary (before any DB ids exist).
 */
export interface MinutesWithActions {
  minutes: Minutes;
  actions: LegislativeAction[];
}

// ============================================
// CAMPAIGN FINANCE
// ============================================

/**
 * Committee types for campaign finance tracking
 */
export enum CommitteeType {
  CANDIDATE = "candidate",
  BALLOT_MEASURE = "ballot_measure",
  PAC = "pac",
  SUPER_PAC = "super_pac",
  PARTY = "party",
  SMALL_CONTRIBUTOR = "small_contributor",
  OTHER = "other",
}

/**
 * Campaign committee (fundraising entity)
 */
export interface Committee {
  externalId: string;
  name: string;
  type: CommitteeType;
  candidateName?: string;
  candidateOffice?: string;
  propositionId?: string;
  party?: string;
  status: "active" | "terminated";
  sourceSystem: "cal_access" | "fec";
  sourceUrl?: string;
}

/**
 * Campaign contribution (money received by a committee)
 */
export interface Contribution {
  externalId: string;
  committeeId: string;
  donorName: string;
  donorType: "individual" | "committee" | "party" | "self" | "other";
  donorEmployer?: string;
  donorOccupation?: string;
  donorCity?: string;
  donorState?: string;
  donorZip?: string;
  amount: number;
  date: Date;
  electionType?: string;
  contributionType?: string;
  sourceSystem: "cal_access" | "fec";
}

/**
 * Campaign expenditure (money spent by a committee)
 */
export interface Expenditure {
  externalId: string;
  committeeId: string;
  payeeName: string;
  amount: number;
  date: Date;
  purposeDescription?: string;
  expenditureCode?: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose?: "support" | "oppose";
  sourceSystem: "cal_access" | "fec";
}

/**
 * Independent expenditure (outside spending for/against candidate or measure)
 */
export interface IndependentExpenditure {
  externalId: string;
  committeeId: string;
  committeeName: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose: "support" | "oppose";
  amount: number;
  date: Date;
  electionDate?: Date;
  description?: string;
  sourceSystem: "cal_access" | "fec";
}

/**
 * Raw CVR2_CAMPAIGN_DISCLOSURE_CD record from CalAccess. Each row represents
 * one ballot-measure declaration on an FPPC Form 410 filing — links a filing
 * (and therefore a committee) to a specific measure with a support/oppose
 * code. Persisted as-is so the proposition-finance-linker can resolve to
 * (committeeId, propositionId) at link time, decoupled from the bulk-download
 * cycle order.
 */
export interface CommitteeMeasureFiling {
  externalId: string; // FILING_ID + LINE_ITEM
  filingId: string; // FILING_ID — joinable to Contribution.externalId / Expenditure.externalId
  ballotName?: string; // BAL_NAME — fuzzy-matches Proposition.title
  ballotNumber?: string; // BAL_NUM — e.g. "ACA 13"
  ballotJurisdiction?: string; // BAL_JURIS
  supportOrOppose?: "support" | "oppose"; // mapped from SUP_OPP_CD
  sourceSystem: "cal_access" | "fec";
}

/**
 * Aggregated result from campaign finance data fetch
 */
export interface CampaignFinanceResult {
  committees: Committee[];
  contributions: Contribution[];
  expenditures: Expenditure[];
  independentExpenditures: IndependentExpenditure[];
  committeeMeasureFilings: CommitteeMeasureFiling[];
}

/**
 * Sync result metadata
 */
export interface SyncResult {
  dataType: DataType;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  errors: string[];
  syncedAt: Date;
}

/**
 * Strategy interface for region providers
 */
export interface IRegionProvider {
  /**
   * Get the provider name (e.g., "example", "california")
   */
  getName(): string;

  /**
   * Get region information and configuration
   */
  getRegionInfo(): RegionInfo;

  /**
   * Get the list of data types this provider supports
   */
  getSupportedDataTypes(): DataType[];

  /**
   * Fetch propositions from the region's data sources
   */
  fetchPropositions(): Promise<Proposition[]>;

  /**
   * Fetch meetings from the region's data sources
   */
  fetchMeetings(): Promise<Meeting[]>;

  /**
   * Fetch representatives from the region's data sources
   */
  fetchRepresentatives(): Promise<Representative[]>;

  /**
   * Fetch campaign finance data from the region's data sources.
   * Optional — only implemented by plugins with campaign_finance data sources.
   * When onBatch is provided, bulk sources stream batches to the callback
   * instead of accumulating all records in memory.
   */
  fetchCampaignFinance?(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
  ): Promise<CampaignFinanceResult>;

  /**
   * Fetch meeting-minutes / journal documents. V1 returns Minutes
   * records with empty `actions`; the backend linker mines `rawText`
   * post-sync to produce the action records. Returning the bundled
   * shape now keeps the door open for fetcher-side extraction in V2
   * (e.g. AI-driven structural analysis at fetch time) without
   * changing the interface.
   *
   * Optional — only implemented by plugins with legislative_actions
   * data sources. The handler walks the listing page descending by
   * date and stops at a watermark (`ingestion_watermarks` table) or a
   * configured `maxNew` cap to bound cold-start work. Issue #665.
   */
  fetchLegislativeActions?(): Promise<MinutesWithActions[]>;
}

/**
 * Exception thrown when region data fetch fails
 */
export class RegionError extends Error {
  constructor(
    public provider: string,
    public dataType: DataType | string,
    public originalError: Error,
  ) {
    super(
      `Region data fetch failed in ${provider} for ${dataType}: ${originalError.message}`,
    );
    this.name = "RegionError";
  }
}

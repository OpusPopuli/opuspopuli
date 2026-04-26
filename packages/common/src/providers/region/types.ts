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

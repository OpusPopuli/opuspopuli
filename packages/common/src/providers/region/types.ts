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
 * Contact information for representatives
 */
export interface ContactInfo {
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
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
 * Aggregated result from campaign finance data fetch
 */
export interface CampaignFinanceResult {
  committees: Committee[];
  contributions: Contribution[];
  expenditures: Expenditure[];
  independentExpenditures: IndependentExpenditure[];
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
   */
  fetchCampaignFinance?(): Promise<CampaignFinanceResult>;
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

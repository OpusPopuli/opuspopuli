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
}

/** @deprecated Use DataType instead */
export const CivicDataType = DataType;
/** @deprecated Use DataType instead */
export type CivicDataType = DataType;

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

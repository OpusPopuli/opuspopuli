import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export type PropositionStatus = "PENDING" | "PASSED" | "FAILED" | "WITHDRAWN";
export type DataType =
  | "PROPOSITIONS"
  | "MEETINGS"
  | "REPRESENTATIVES"
  | "CAMPAIGN_FINANCE"
  | "CIVICS"
  | "BILLS";

// ── Civics types ──────────────────────────────────────────────────────────────

export interface CivicText {
  verbatim: string;
  plainLanguage: string;
  sourceUrl: string;
}

export interface CivicsChamber {
  name: string;
  abbreviation: string;
  size: number;
  termYears: number;
  leadershipRoles: string[];
  description: CivicText;
}

export interface CitizenAction {
  verb: string;
  label: CivicText;
  url?: string;
  urgency: "active" | "passive" | "none";
}

export interface CivicsLifecycleStage {
  id: string;
  name: CivicText;
  shortDescription: CivicText;
  longDescription?: CivicText;
  statusStringPatterns: string[];
  citizenAction?: CitizenAction;
}

export interface CivicsMeasureType {
  code: string;
  name: string;
  chamber: string;
  votingThreshold: string;
  reachesGovernor: boolean;
  purpose: CivicText;
  lifecycleStageIds: string[];
}

export interface CivicsGlossaryEntry {
  term: string;
  slug: string;
  definition: CivicText;
  longDefinition?: CivicText;
  relatedTerms: string[];
}

export interface CivicsSessionScheme {
  cadence: string;
  namingPattern: string;
  description: CivicText;
}

export interface CivicsBlock {
  chambers: CivicsChamber[];
  measureTypes: CivicsMeasureType[];
  lifecycleStages: CivicsLifecycleStage[];
  sessionScheme?: CivicsSessionScheme;
  glossary: CivicsGlossaryEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RegionInfo {
  id: string;
  name: string;
  description: string;
  timezone: string;
  dataSourceUrls?: string[];
  supportedDataTypes: DataType[];
  civics?: CivicsBlock;
}

/**
 * AI-segmented ToC anchor into Proposition.fullText, used by
 * SegmentedFullText to render collapsible sections with a sticky sidebar.
 */
export interface PropositionAnalysisSection {
  heading: string;
  startOffset: number;
  endOffset: number;
}

/**
 * A single AI-derived claim with a citation range into fullText. Rendered
 * as an inline footnote next to analysis content; clicking scrolls to the
 * attributed range in the Deep Dive layer and highlights it.
 */
export interface PropositionAnalysisClaim {
  claim: string;
  /** Which analysis field the claim backs (keyProvisions, fiscalImpact, etc.). */
  field: string;
  sourceStart: number;
  sourceEnd: number;
  confidence?: string;
}

export interface PropositionExistingVsProposed {
  current: string;
  proposed: string;
}

export interface Proposition {
  id: string;
  externalId: string;
  title: string;
  summary: string;
  fullText?: string;
  status: PropositionStatus;
  electionDate?: string;
  sourceUrl?: string;

  analysisSummary?: string;
  keyProvisions?: string[];
  fiscalImpact?: string;
  yesOutcome?: string;
  noOutcome?: string;
  existingVsProposed?: PropositionExistingVsProposed;
  analysisSections?: PropositionAnalysisSection[];
  analysisClaims?: PropositionAnalysisClaim[];
  analysisSource?: string;
  analysisGeneratedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPropositions {
  items: Proposition[];
  total: number;
  hasMore: boolean;
}

export interface Meeting {
  id: string;
  externalId: string;
  title: string;
  body: string;
  scheduledAt: string;
  location?: string;
  agendaUrl?: string;
  videoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedMeetings {
  items: Meeting[];
  total: number;
  hasMore: boolean;
}

export interface CommitteeAssignment {
  name: string;
  role?: string;
  url?: string;
  legislativeCommitteeId?: string;
}

export interface Representative {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  district: string;
  party?: string;
  photoUrl?: string;
  contactInfo?: ContactInfo;
  committees?: CommitteeAssignment[];
  committeesSummary?: string;
  bio?: string;
  bioSource?: string;
  bioClaims?: BioClaim[];
  /** AI-generated 2-3 sentence summary of recent legislative activity. Issue #665. */
  activitySummary?: string;
  activitySummaryGeneratedAt?: string;
  activitySummaryWindowDays?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-sentence attribution for an AI-generated bio. See #602.
 */
export interface BioClaim {
  sentence: string;
  /** "source" (from authoritative input) or "training" (from LLM training data). */
  origin: string;
  sourceField?: string | null;
  sourceHint?: string | null;
  /** "high" or "medium" — the LLM's self-reported confidence. */
  confidence?: string;
}

export interface Office {
  name: string;
  address?: string;
  phone?: string;
  fax?: string;
}

export interface ContactInfo {
  email?: string;
  website?: string;
  offices?: Office[];
}

export interface PaginatedRepresentatives {
  items: Representative[];
  total: number;
  hasMore: boolean;
}

export interface Committee {
  id: string;
  externalId: string;
  name: string;
  type: string;
  candidateName?: string;
  candidateOffice?: string;
  propositionId?: string;
  party?: string;
  status: string;
  sourceSystem: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedCommittees {
  items: Committee[];
  total: number;
  hasMore: boolean;
}

export interface LegislativeCommittee {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  url?: string;
  description?: string;
  memberCount: number;
}

export interface PaginatedLegislativeCommittees {
  items: LegislativeCommittee[];
  total: number;
  hasMore: boolean;
}

export interface LegislativeCommitteeMember {
  representativeId: string;
  name: string;
  role?: string;
  party?: string;
  photoUrl?: string;
}

export interface LegislativeCommitteeHearing {
  id: string;
  title: string;
  scheduledAt: string;
  agendaUrl?: string;
}

export interface LegislativeCommitteeDetail {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  url?: string;
  description?: string;
  memberCount: number;
  members: LegislativeCommitteeMember[];
  hearings: LegislativeCommitteeHearing[];
  /** AI-generated 2-3 sentence summary of recent committee activity. Issue #665. */
  activitySummary?: string;
  activitySummaryGeneratedAt?: string;
  activitySummaryWindowDays?: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// LEGISLATIVE ACTIONS (issue #665)
// ============================================

/** One discrete legislative action mined from a Minutes document. */
export interface LegislativeAction {
  id: string;
  externalId: string;
  body: string;
  date: string;
  /**
   * 'presence' | 'committee_hearing' | 'committee_report' |
   * 'amendment' | 'engrossment' | 'enrollment' | 'resolution' |
   * 'vote' (V2) | 'speech' (V2)
   */
  actionType: string;
  /** 'yes' | 'no' | 'abstain' | 'absent' — null for non-vote actions in V1. */
  position?: string;
  text?: string;
  passageStart?: number;
  passageEnd?: number;
  rawSubject?: string;
  representativeId?: string;
  propositionId?: string;
  committeeId?: string;
  minutesId: string;
  minutesExternalId: string;
}

export interface PaginatedLegislativeActions {
  items: LegislativeAction[];
  total: number;
  hasMore: boolean;
}

/**
 * At-a-glance counters for the rep detail page Layer 3
 * ("What They've Done"). Drives the top-of-L3 stats grid.
 */
export interface RepresentativeActivityStats {
  presentSessionDays: number;
  totalSessionDays: number;
  absenceDays: number;
  amendments: number;
  committeeHearings: number;
  committeeReports: number;
  resolutions: number;
  votes: number;
  speeches: number;
}

/**
 * At-a-glance counters for the legislative committee detail page
 * Layer 3 ("Activity"). Drives the top-of-L3 stats grid.
 */
export interface CommitteeActivityStats {
  hearings: number;
  reports: number;
  amendments: number;
  distinctBills: number;
}

/** Verbatim passage from Minutes.rawText for an action. */
export interface MinutesPassage {
  actionId: string;
  minutesExternalId: string;
  body: string;
  date: string;
  sourceUrl: string;
  passageStart: number;
  passageEnd: number;
  passageText: string;
  sectionContext?: string;
}

export interface Contribution {
  id: string;
  externalId: string;
  committeeId: string;
  donorName: string;
  donorType: string;
  donorEmployer?: string;
  donorOccupation?: string;
  donorCity?: string;
  donorState?: string;
  donorZip?: string;
  amount: number;
  date: string;
  electionType?: string;
  contributionType?: string;
  sourceSystem: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedContributions {
  items: Contribution[];
  total: number;
  hasMore: boolean;
}

export interface Expenditure {
  id: string;
  externalId: string;
  committeeId: string;
  payeeName: string;
  amount: number;
  date: string;
  purposeDescription?: string;
  expenditureCode?: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose?: string;
  sourceSystem: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedExpenditures {
  items: Expenditure[];
  total: number;
  hasMore: boolean;
}

export interface IndependentExpenditure {
  id: string;
  externalId: string;
  committeeId: string;
  committeeName: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose: string;
  amount: number;
  date: string;
  electionDate?: string;
  description?: string;
  sourceSystem: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedIndependentExpenditures {
  items: IndependentExpenditure[];
  total: number;
  hasMore: boolean;
}

export interface SyncResult {
  dataType: DataType;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: string[];
  syncedAt: string;
}

// ============================================
// Query Response Types
// ============================================

export interface RegionInfoData {
  regionInfo: RegionInfo;
}

export interface PropositionsData {
  propositions: PaginatedPropositions;
}

export interface PropositionData {
  proposition: Proposition | null;
}

export interface MeetingsData {
  meetings: PaginatedMeetings;
}

export interface MeetingData {
  meeting: Meeting | null;
}

export interface RepresentativesData {
  representatives: PaginatedRepresentatives;
}

export interface RepresentativeData {
  representative: Representative | null;
}

export interface CommitteesData {
  committees: PaginatedCommittees;
}

export interface CommitteeData {
  committee: Committee | null;
}

export interface LegislativeCommitteesData {
  legislativeCommittees: PaginatedLegislativeCommittees;
}

export interface LegislativeCommitteeData {
  legislativeCommittee: LegislativeCommitteeDetail | null;
}

export interface ContributionsData {
  contributions: PaginatedContributions;
}

export interface ContributionData {
  contribution: Contribution | null;
}

export interface ExpendituresData {
  expenditures: PaginatedExpenditures;
}

export interface ExpenditureData {
  expenditure: Expenditure | null;
}

export interface IndependentExpendituresData {
  independentExpenditures: PaginatedIndependentExpenditures;
}

export interface IndependentExpenditureData {
  independentExpenditure: IndependentExpenditure | null;
}

export interface SyncAllData {
  syncAll: SyncResult[];
}

export interface SyncDataTypeData {
  syncDataType: SyncResult;
}

// ============================================
// Variables Types
// ============================================

export interface PaginationVars {
  skip?: number;
  take?: number;
}

export interface RepresentativesVars extends PaginationVars {
  chamber?: string;
}

export interface IdVars {
  id: string;
}

export interface CommitteesVars extends PaginationVars {
  sourceSystem?: string;
}

export interface LegislativeCommitteesVars extends PaginationVars {
  chamber?: string;
}

export interface ContributionsVars extends PaginationVars {
  committeeId?: string;
  sourceSystem?: string;
}

export interface ExpendituresVars extends PaginationVars {
  committeeId?: string;
  sourceSystem?: string;
}

export interface IndependentExpendituresVars extends PaginationVars {
  committeeId?: string;
  supportOrOppose?: string;
  sourceSystem?: string;
}

export interface SyncDataTypeVars {
  dataType: DataType;
}

// ============================================
// Queries
// ============================================

const CIVIC_TEXT_FIELDS = gql`
  fragment CivicTextFields on CivicText {
    verbatim
    plainLanguage
    sourceUrl
  }
`;

export const GET_REGION_INFO = gql`
  ${CIVIC_TEXT_FIELDS}
  query GetRegionInfo {
    regionInfo {
      id
      name
      description
      timezone
      dataSourceUrls
      supportedDataTypes
      civics {
        chambers {
          name
          abbreviation
          size
          termYears
          leadershipRoles
          description {
            ...CivicTextFields
          }
        }
        measureTypes {
          code
          name
          chamber
          votingThreshold
          reachesGovernor
          purpose {
            ...CivicTextFields
          }
          lifecycleStageIds
        }
        lifecycleStages {
          id
          name {
            ...CivicTextFields
          }
          shortDescription {
            ...CivicTextFields
          }
          longDescription {
            ...CivicTextFields
          }
          statusStringPatterns
          citizenAction {
            verb
            label {
              ...CivicTextFields
            }
            url
            urgency
          }
        }
        sessionScheme {
          cadence
          namingPattern
          description {
            ...CivicTextFields
          }
        }
        glossary {
          term
          slug
          definition {
            ...CivicTextFields
          }
          longDefinition {
            ...CivicTextFields
          }
          relatedTerms
        }
      }
    }
  }
`;

export const GET_PROPOSITIONS = gql`
  query GetPropositions($skip: Int, $take: Int) {
    propositions(skip: $skip, take: $take) {
      items {
        id
        externalId
        title
        summary
        analysisSummary
        status
        electionDate
        sourceUrl
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_PROPOSITION = gql`
  query GetProposition($id: ID!) {
    proposition(id: $id) {
      id
      externalId
      title
      summary
      fullText
      status
      electionDate
      sourceUrl
      analysisSummary
      keyProvisions
      fiscalImpact
      yesOutcome
      noOutcome
      existingVsProposed {
        current
        proposed
      }
      analysisSections {
        heading
        startOffset
        endOffset
      }
      analysisClaims {
        claim
        field
        sourceStart
        sourceEnd
        confidence
      }
      analysisSource
      analysisGeneratedAt
      createdAt
      updatedAt
    }
  }
`;

/** A single donor's aggregated giving to one side of a measure. */
export interface TopDonor {
  donorName: string;
  totalAmount: number;
  contributionCount: number;
}

/** Compact summary of a primarily-formed committee for a measure. */
export interface CommitteeSummaryFunding {
  id: string;
  name: string;
  totalRaised: number;
}

/** Funding totals for one side (support or oppose) of a ballot measure. */
export interface SidedFunding {
  totalRaised: number;
  totalSpent: number;
  donorCount: number;
  committeeCount: number;
  topDonors: TopDonor[];
  primaryCommittees: CommitteeSummaryFunding[];
}

/** Aggregated funding for a single proposition. */
export interface PropositionFunding {
  propositionId: string;
  asOf: string;
  support: SidedFunding;
  oppose: SidedFunding;
}

export interface PropositionFundingData {
  propositionFunding: PropositionFunding | null;
}

export interface PropositionIdVars {
  propositionId: string;
}

export const GET_PROPOSITION_FUNDING = gql`
  query GetPropositionFunding($propositionId: ID!) {
    propositionFunding(propositionId: $propositionId) {
      propositionId
      asOf
      support {
        totalRaised
        totalSpent
        donorCount
        committeeCount
        topDonors {
          donorName
          totalAmount
          contributionCount
        }
        primaryCommittees {
          id
          name
          totalRaised
        }
      }
      oppose {
        totalRaised
        totalSpent
        donorCount
        committeeCount
        topDonors {
          donorName
          totalAmount
          contributionCount
        }
        primaryCommittees {
          id
          name
          totalRaised
        }
      }
    }
  }
`;

export const REGENERATE_PROPOSITION_ANALYSIS = gql`
  mutation RegeneratePropositionAnalysis($id: ID!) {
    regeneratePropositionAnalysis(id: $id) {
      id
      analysisSummary
      keyProvisions
      fiscalImpact
      yesOutcome
      noOutcome
      existingVsProposed {
        current
        proposed
      }
      analysisSections {
        heading
        startOffset
        endOffset
      }
      analysisClaims {
        claim
        field
        sourceStart
        sourceEnd
        confidence
      }
      analysisSource
      analysisGeneratedAt
    }
  }
`;

export const GET_MEETINGS = gql`
  query GetMeetings($skip: Int, $take: Int) {
    meetings(skip: $skip, take: $take) {
      items {
        id
        externalId
        title
        body
        scheduledAt
        location
        agendaUrl
        videoUrl
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_MEETING = gql`
  query GetMeeting($id: ID!) {
    meeting(id: $id) {
      id
      externalId
      title
      body
      scheduledAt
      location
      agendaUrl
      videoUrl
      createdAt
      updatedAt
    }
  }
`;

export const GET_REPRESENTATIVES = gql`
  query GetRepresentatives($skip: Int, $take: Int, $chamber: String) {
    representatives(skip: $skip, take: $take, chamber: $chamber) {
      items {
        id
        externalId
        name
        chamber
        district
        party
        photoUrl
        contactInfo {
          email
          website
          offices {
            name
            address
            phone
            fax
          }
        }
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_REPRESENTATIVE = gql`
  query GetRepresentative($id: ID!) {
    representative(id: $id) {
      id
      externalId
      name
      chamber
      district
      party
      photoUrl
      contactInfo {
        email
        website
        offices {
          name
          address
          phone
          fax
        }
      }
      committees {
        name
        role
        url
        legislativeCommitteeId
      }
      committeesSummary
      bio
      bioSource
      bioClaims {
        sentence
        origin
        sourceField
        sourceHint
        confidence
      }
      activitySummary
      activitySummaryGeneratedAt
      activitySummaryWindowDays
      createdAt
      updatedAt
    }
  }
`;

export const GET_REPRESENTATIVES_BY_DISTRICTS = gql`
  query GetRepresentativesByDistricts(
    $congressionalDistrict: String
    $stateSenatorialDistrict: String
    $stateAssemblyDistrict: String
    $countyRegionId: String
  ) {
    representativesByDistricts(
      congressionalDistrict: $congressionalDistrict
      stateSenatorialDistrict: $stateSenatorialDistrict
      stateAssemblyDistrict: $stateAssemblyDistrict
      countyRegionId: $countyRegionId
    ) {
      id
      name
      chamber
      district
      party
      photoUrl
    }
  }
`;

export interface RepresentativesByDistrictsData {
  representativesByDistricts: Representative[];
}

export const GET_COUNTY_REPRESENTATIVES = gql`
  query GetCountyRepresentatives($countyRegionId: String!) {
    countyRepresentatives(countyRegionId: $countyRegionId) {
      id
      name
      chamber
      district
      party
      photoUrl
    }
  }
`;

export interface CountyRepresentativesData {
  countyRepresentatives: Representative[];
}

export const MY_COUNTY_SUPERVISORS = gql`
  query MyCountySupervisors {
    myCountySupervisors {
      id
      name
      chamber
      district
      party
      photoUrl
    }
  }
`;

export interface MyCountySupervisorsData {
  myCountySupervisors: Representative[];
}

// ============================================
// Campaign Finance Queries
// ============================================

export const GET_COMMITTEES = gql`
  query GetCommittees($skip: Int, $take: Int, $sourceSystem: String) {
    committees(skip: $skip, take: $take, sourceSystem: $sourceSystem) {
      items {
        id
        externalId
        name
        type
        candidateName
        candidateOffice
        propositionId
        party
        status
        sourceSystem
        sourceUrl
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_COMMITTEE = gql`
  query GetCommittee($id: ID!) {
    committee(id: $id) {
      id
      externalId
      name
      type
      candidateName
      candidateOffice
      propositionId
      party
      status
      sourceSystem
      sourceUrl
      createdAt
      updatedAt
    }
  }
`;

export const GET_LEGISLATIVE_COMMITTEES = gql`
  query GetLegislativeCommittees(
    $skip: Int
    $take: Int
    $chamber: String
    $nameFilter: String
  ) {
    legislativeCommittees(
      skip: $skip
      take: $take
      chamber: $chamber
      nameFilter: $nameFilter
    ) {
      items {
        id
        externalId
        name
        chamber
        url
        description
        memberCount
      }
      total
      hasMore
    }
  }
`;

export const GET_LEGISLATIVE_COMMITTEE = gql`
  query GetLegislativeCommittee($id: ID!) {
    legislativeCommittee(id: $id) {
      id
      externalId
      name
      chamber
      url
      description
      memberCount
      members {
        representativeId
        name
        role
        party
        photoUrl
      }
      hearings {
        id
        title
        scheduledAt
        agendaUrl
      }
      activitySummary
      activitySummaryGeneratedAt
      activitySummaryWindowDays
      createdAt
      updatedAt
    }
  }
`;

export const GET_CONTRIBUTIONS = gql`
  query GetContributions(
    $skip: Int
    $take: Int
    $committeeId: String
    $sourceSystem: String
  ) {
    contributions(
      skip: $skip
      take: $take
      committeeId: $committeeId
      sourceSystem: $sourceSystem
    ) {
      items {
        id
        externalId
        committeeId
        donorName
        donorType
        amount
        date
        sourceSystem
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_CONTRIBUTION = gql`
  query GetContribution($id: ID!) {
    contribution(id: $id) {
      id
      externalId
      committeeId
      donorName
      donorType
      donorEmployer
      donorOccupation
      donorCity
      donorState
      donorZip
      amount
      date
      electionType
      contributionType
      sourceSystem
      createdAt
      updatedAt
    }
  }
`;

export const GET_EXPENDITURES = gql`
  query GetExpenditures(
    $skip: Int
    $take: Int
    $committeeId: String
    $sourceSystem: String
  ) {
    expenditures(
      skip: $skip
      take: $take
      committeeId: $committeeId
      sourceSystem: $sourceSystem
    ) {
      items {
        id
        externalId
        committeeId
        payeeName
        amount
        date
        purposeDescription
        supportOrOppose
        sourceSystem
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_EXPENDITURE = gql`
  query GetExpenditure($id: ID!) {
    expenditure(id: $id) {
      id
      externalId
      committeeId
      payeeName
      amount
      date
      purposeDescription
      expenditureCode
      candidateName
      propositionTitle
      supportOrOppose
      sourceSystem
      createdAt
      updatedAt
    }
  }
`;

export const GET_INDEPENDENT_EXPENDITURES = gql`
  query GetIndependentExpenditures(
    $skip: Int
    $take: Int
    $committeeId: String
    $supportOrOppose: String
    $sourceSystem: String
  ) {
    independentExpenditures(
      skip: $skip
      take: $take
      committeeId: $committeeId
      supportOrOppose: $supportOrOppose
      sourceSystem: $sourceSystem
    ) {
      items {
        id
        externalId
        committeeId
        committeeName
        candidateName
        propositionTitle
        supportOrOppose
        amount
        date
        sourceSystem
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_INDEPENDENT_EXPENDITURE = gql`
  query GetIndependentExpenditure($id: ID!) {
    independentExpenditure(id: $id) {
      id
      externalId
      committeeId
      committeeName
      candidateName
      propositionTitle
      supportOrOppose
      amount
      date
      electionDate
      description
      sourceSystem
      createdAt
      updatedAt
    }
  }
`;

// ============================================
// Mutations
// ============================================

export const SYNC_ALL = gql`
  mutation SyncAll {
    syncAll {
      dataType
      itemsProcessed
      itemsCreated
      itemsUpdated
      errors
      syncedAt
    }
  }
`;

export const SYNC_DATA_TYPE = gql`
  mutation SyncDataType($dataType: DataType!) {
    syncDataType(dataType: $dataType) {
      dataType
      itemsProcessed
      itemsCreated
      itemsUpdated
      errors
      syncedAt
    }
  }
`;

// ============================================
// LEGISLATIVE ACTIONS (issue #665)
// ============================================

export const GET_REP_ACTIVITY_STATS = gql`
  query GetRepresentativeActivityStats($id: ID!, $sinceDays: Int) {
    representativeActivityStats(id: $id, sinceDays: $sinceDays) {
      presentSessionDays
      totalSessionDays
      absenceDays
      amendments
      committeeHearings
      committeeReports
      resolutions
      votes
      speeches
    }
  }
`;

export const GET_REP_ACTIVITY = gql`
  query GetRepresentativeActivity(
    $id: ID!
    $actionTypes: [String!]
    $includePresenceYes: Boolean
    $skip: Int
    $take: Int
  ) {
    representativeActivity(
      id: $id
      actionTypes: $actionTypes
      includePresenceYes: $includePresenceYes
      skip: $skip
      take: $take
    ) {
      items {
        id
        externalId
        body
        date
        actionType
        position
        text
        passageStart
        passageEnd
        rawSubject
        representativeId
        propositionId
        committeeId
        minutesId
        minutesExternalId
      }
      total
      hasMore
    }
  }
`;

export const GET_MINUTES_PASSAGE = gql`
  query GetMinutesPassage($actionId: ID!) {
    minutesPassage(actionId: $actionId) {
      actionId
      minutesExternalId
      body
      date
      sourceUrl
      passageStart
      passageEnd
      passageText
      sectionContext
    }
  }
`;

export const GET_COMMITTEE_ACTIVITY_STATS = gql`
  query GetCommitteeActivityStats($committeeId: ID!, $sinceDays: Int) {
    committeeActivityStats(committeeId: $committeeId, sinceDays: $sinceDays) {
      hearings
      reports
      amendments
      distinctBills
    }
  }
`;

export const GET_COMMITTEE_ACTIVITY = gql`
  query GetCommitteeActivity(
    $committeeId: ID!
    $actionTypes: [String!]
    $skip: Int
    $take: Int
  ) {
    committeeActivity(
      committeeId: $committeeId
      actionTypes: $actionTypes
      skip: $skip
      take: $take
    ) {
      items {
        id
        externalId
        body
        date
        actionType
        position
        text
        passageStart
        passageEnd
        rawSubject
        representativeId
        propositionId
        committeeId
        minutesId
        minutesExternalId
      }
      total
      hasMore
    }
  }
`;

// ============================================
// BILLS (issue #686)
// ============================================

export interface BillVote {
  id: string;
  representativeName: string;
  representativeId?: string;
  chamber: string;
  voteDate: string;
  /** yes | no | abstain | absent | excused | no_vote */
  position: string;
  motionText?: string;
  sourceUrl: string;
}

export interface BillCoAuthor {
  representativeId?: string;
  name: string;
  /** "principal coauthor" | "coauthor" */
  coAuthorType?: string;
}

export interface Bill {
  id: string;
  externalId: string;
  billNumber: string;
  sessionYear: string;
  measureTypeCode: string;
  title: string;
  subject?: string;
  status?: string;
  currentStageId?: string;
  lastAction?: string;
  lastActionDate?: string;
  fiscalImpact?: string;
  fullTextUrl?: string;
  authorId?: string;
  authorName?: string;
  sourceUrl: string;
  extractedAt: string;
  createdAt: string;
  updatedAt: string;
  votes: BillVote[];
  coAuthors: BillCoAuthor[];
}

export interface PaginatedBills {
  items: Bill[];
  total: number;
  hasMore: boolean;
}

export interface BillsData {
  bills: PaginatedBills;
}

export interface BillData {
  bill: Bill | null;
}

export interface BillsVars {
  skip?: number;
  take?: number;
  measureTypeCode?: string;
  sessionYear?: string;
  authorId?: string;
  committeeId?: string;
}

export interface BillIdVars {
  id: string;
}

const BILL_VOTE_FIELDS = gql`
  fragment BillVoteFields on BillVote {
    id
    representativeName
    representativeId
    chamber
    voteDate
    position
    motionText
    sourceUrl
  }
`;

const BILL_CO_AUTHOR_FIELDS = gql`
  fragment BillCoAuthorFields on BillCoAuthor {
    representativeId
    name
    coAuthorType
  }
`;

export const GET_BILLS = gql`
  query GetBills(
    $skip: Int
    $take: Int
    $measureTypeCode: String
    $sessionYear: String
    $authorId: ID
    $committeeId: ID
  ) {
    bills(
      skip: $skip
      take: $take
      measureTypeCode: $measureTypeCode
      sessionYear: $sessionYear
      authorId: $authorId
      committeeId: $committeeId
    ) {
      items {
        id
        externalId
        billNumber
        sessionYear
        measureTypeCode
        title
        subject
        status
        currentStageId
        lastAction
        lastActionDate
        authorId
        authorName
        sourceUrl
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const GET_BILL = gql`
  ${BILL_VOTE_FIELDS}
  ${BILL_CO_AUTHOR_FIELDS}
  query GetBill($id: ID!) {
    bill(id: $id) {
      id
      externalId
      billNumber
      sessionYear
      measureTypeCode
      title
      subject
      status
      currentStageId
      lastAction
      lastActionDate
      fiscalImpact
      fullTextUrl
      authorId
      authorName
      sourceUrl
      extractedAt
      createdAt
      updatedAt
      votes {
        ...BillVoteFields
      }
      coAuthors {
        ...BillCoAuthorFields
      }
    }
  }
`;

// ============================================
// JURISDICTION TYPES & QUERY (#690)
// ============================================

export type JurisdictionType =
  | "STATE"
  | "CONGRESSIONAL_DISTRICT"
  | "STATE_SENATE_DISTRICT"
  | "STATE_ASSEMBLY_DISTRICT"
  | "COUNTY"
  | "CITY"
  | "SCHOOL_DISTRICT_UNIFIED"
  | "SCHOOL_DISTRICT_ELEMENTARY"
  | "SCHOOL_DISTRICT_HIGH"
  | "COMMUNITY_COLLEGE_DISTRICT"
  | "WATER_DISTRICT"
  | "FIRE_DISTRICT"
  | "TRANSIT_DISTRICT"
  | "SPECIAL_DISTRICT";

export type JurisdictionLevel =
  | "FEDERAL"
  | "STATE"
  | "COUNTY"
  | "MUNICIPAL"
  | "DISTRICT";

export interface JurisdictionData {
  id: string;
  fipsCode?: string;
  ocdId?: string;
  name: string;
  type: JurisdictionType;
  level: JurisdictionLevel;
  stateCode: string;
  parent?: {
    id: string;
    name: string;
    type: JurisdictionType;
    level: JurisdictionLevel;
  };
}

export interface UserJurisdictionData {
  resolvedBy: string;
  resolvedAt: string;
  jurisdiction: JurisdictionData;
}

export interface MyJurisdictionsData {
  myJurisdictions: UserJurisdictionData[];
}

export const MY_JURISDICTIONS = gql`
  query MyJurisdictions {
    myJurisdictions {
      resolvedBy
      resolvedAt
      jurisdiction {
        id
        fipsCode
        ocdId
        name
        type
        level
        stateCode
        parent {
          id
          name
          type
          level
        }
      }
    }
  }
`;

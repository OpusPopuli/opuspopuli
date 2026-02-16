import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export type PropositionStatus = "PENDING" | "PASSED" | "FAILED" | "WITHDRAWN";
export type DataType =
  | "PROPOSITIONS"
  | "MEETINGS"
  | "REPRESENTATIVES"
  | "CAMPAIGN_FINANCE";

export interface RegionInfo {
  id: string;
  name: string;
  description: string;
  timezone: string;
  dataSourceUrls?: string[];
  supportedDataTypes: DataType[];
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

export interface Representative {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  district: string;
  party: string;
  photoUrl?: string;
  contactInfo?: ContactInfo;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInfo {
  email?: string;
  phone?: string;
  office?: string;
  website?: string;
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

export const GET_REGION_INFO = gql`
  query GetRegionInfo {
    regionInfo {
      id
      name
      description
      timezone
      dataSourceUrls
      supportedDataTypes
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
      createdAt
      updatedAt
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
          phone
          office
          website
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
        phone
        office
        website
      }
      createdAt
      updatedAt
    }
  }
`;

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

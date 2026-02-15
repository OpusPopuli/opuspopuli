import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export type PropositionStatus = "PENDING" | "PASSED" | "FAILED" | "WITHDRAWN";
export type DataType = "PROPOSITIONS" | "MEETINGS" | "REPRESENTATIVES";

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

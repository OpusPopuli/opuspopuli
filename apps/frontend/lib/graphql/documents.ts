import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export interface GeoLocationInput {
  latitude: number;
  longitude: number;
}

export interface SetDocumentLocationInput {
  documentId: string;
  location: GeoLocationInput;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

export interface SetDocumentLocationResult {
  success: boolean;
  fuzzedLocation?: GeoLocation;
}

export interface ProcessScanInput {
  data: string;
  mimeType: string;
  documentType?: string;
}

export interface ProcessScanResult {
  documentId: string;
  text: string;
  confidence: number;
  provider: string;
  processingTimeMs: number;
}

export interface AnalyzeDocumentInput {
  documentId: string;
  forceReanalyze?: boolean;
}

export interface DocumentAnalysis {
  documentType: string;
  summary: string;
  keyPoints: string[];
  entities: string[];
  analyzedAt: string;
  provider: string;
  model: string;
  tokensUsed?: number;
  processingTimeMs: number;
  cachedFrom?: string;
  // Petition/proposition fields
  actualEffect?: string;
  potentialConcerns?: string[];
  beneficiaries?: string[];
  potentiallyHarmed?: string[];
  relatedMeasures?: string[];
}

export interface AnalyzeDocumentResult {
  analysis: DocumentAnalysis;
  fromCache: boolean;
}

export interface PetitionMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  documentType?: string;
  createdAt: string;
}

export interface PetitionMapStats {
  totalPetitions: number;
  totalWithLocation: number;
  recentPetitions: number;
}

export interface MapBoundsInput {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface MapFiltersInput {
  bounds?: MapBoundsInput;
  documentType?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================
// Mutations
// ============================================

export const SET_DOCUMENT_LOCATION = gql`
  mutation SetDocumentLocation($input: SetDocumentLocationInput!) {
    setDocumentLocation(input: $input) {
      success
      fuzzedLocation {
        latitude
        longitude
      }
    }
  }
`;

export const PROCESS_SCAN = gql`
  mutation ProcessScan($input: ProcessScanInput!) {
    processScan(input: $input) {
      documentId
      text
      confidence
      provider
      processingTimeMs
    }
  }
`;

export const ANALYZE_DOCUMENT = gql`
  mutation AnalyzeDocument($input: AnalyzeDocumentInput!) {
    analyzeDocument(input: $input) {
      analysis {
        documentType
        summary
        keyPoints
        entities
        analyzedAt
        provider
        model
        tokensUsed
        processingTimeMs
        cachedFrom
        actualEffect
        potentialConcerns
        beneficiaries
        potentiallyHarmed
        relatedMeasures
      }
      fromCache
    }
  }
`;

// ============================================
// Queries
// ============================================

export const GET_PETITION_MAP_LOCATIONS = gql`
  query PetitionMapLocations($filters: MapFiltersInput) {
    petitionMapLocations(filters: $filters) {
      id
      latitude
      longitude
      documentType
      createdAt
    }
  }
`;

export const GET_PETITION_MAP_STATS = gql`
  query PetitionMapStats {
    petitionMapStats {
      totalPetitions
      totalWithLocation
      recentPetitions
    }
  }
`;

// ============================================
// Response Types
// ============================================

export interface SetDocumentLocationData {
  setDocumentLocation: SetDocumentLocationResult;
}

export interface ProcessScanData {
  processScan: ProcessScanResult;
}

export interface AnalyzeDocumentData {
  analyzeDocument: AnalyzeDocumentResult;
}

export interface PetitionMapLocationsData {
  petitionMapLocations: PetitionMapMarker[];
}

export interface PetitionMapStatsData {
  petitionMapStats: PetitionMapStats;
}

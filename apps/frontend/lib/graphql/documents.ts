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

// ============================================
// Response Types
// ============================================

export interface SetDocumentLocationData {
  setDocumentLocation: SetDocumentLocationResult;
}

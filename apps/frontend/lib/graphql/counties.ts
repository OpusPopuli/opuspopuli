import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

/** The adjacent county needing the fewest signatures. */
export interface CheapestNeighbor {
  fips: string;
  name: string;
  signaturesRequired: number;
}

/**
 * One county's signature threshold for a county initiative.
 *
 * Public records only. Nothing on this route may carry user, signup or
 * activation data (#1105 criterion 9) — the landing page works without a
 * session, and a field that needed one would either leak or break it.
 */
export interface CountyThreshold {
  fips: string;
  name: string;
  gubernatorialVotes: number;
  gubernatorialYear: number;
  registeredVoters: number | null;
  population: number | null;
  /** ceil(gubernatorialVotes * 0.10), derived server-side per request. */
  signaturesRequired: number;
  /** signaturesRequired / registeredVoters, or null when registration is unknown. */
  shareOfRegistered: number | null;
  /** 1 = fewest signatures required. */
  rank: number;
  cheapestNeighbor: CheapestNeighbor | null;
  /** The record the figures derive from. Rendered, not decoration. */
  sourceUrl: string;
  retrievedAt: string;
}

export interface CountyThresholdsData {
  countyThresholds: CountyThreshold[];
}

// ============================================
// Documents
// ============================================

/**
 * Every county's threshold, cheapest first.
 *
 * Unauthenticated — this backs the public landing route.
 *
 * Geometry is deliberately absent: it is identical for every visitor and
 * changes at most once a decade, so it ships as a static asset rather than
 * riding on each request. Only the figures come from the API.
 */
export const GET_COUNTY_THRESHOLDS = gql`
  query GetCountyThresholds {
    countyThresholds {
      fips
      name
      gubernatorialVotes
      gubernatorialYear
      registeredVoters
      population
      signaturesRequired
      shareOfRegistered
      rank
      cheapestNeighbor {
        fips
        name
        signaturesRequired
      }
      sourceUrl
      retrievedAt
    }
  }
`;

// ============================================
// Statewide constants
// ============================================

/**
 * Statewide initiative requirements for the current cycle.
 *
 * Not derived from county data — these are fixed percentages of the total
 * votes cast for Governor statewide, and they are what make the county
 * figures legible: 5,074 signatures in Nevada County against 546,651
 * statewide is the comparison the page exists to draw.
 *
 * Cal. Const. art. II §8(b) and Elections Code §9035.
 */
export const STATEWIDE_INITIATIVE = {
  /** 5% — an initiative statute. */
  statute: 546651,
  /** 8% — a constitutional amendment. */
  constitutionalAmendment: 874641,
} as const;

/** Elections Code §9118: 10% for a county initiative, 20% compels a special election. */
export const COUNTY_INITIATIVE_RATE = 0.1;
export const COUNTY_SPECIAL_ELECTION_RATE = 0.2;

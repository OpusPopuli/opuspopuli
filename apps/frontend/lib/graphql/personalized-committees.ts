import { gql } from "@apollo/client";

// ============================================
// Personalized committees briefing (opuspopuli#836 follow-up to #770).
//
// Strategy: the existing region `legislativeCommittees(...)` query gains
// a `relevanceExplanation` field via the new field resolver (added in
// #836). The briefing requests committees in bulk and client-side
// filters to those with a non-null cached explanation — meaning the
// nightly batch's LLM produced a topical match worth surfacing for THIS
// user. Today the committee scheduling passes `membersOnUserSlate: []`
// so the explanations are topic-anchored only. Phase 2 enrichment will
// compute the per-user rep-slate intersect so "your rep serves on this
// committee" becomes a possible anchor.
//
// N+1 note: requesting `relevanceExplanation` on N committees triggers
// N cache lookups today. Acceptable for the briefing (we render top 5)
// against an 80-committee CA Assembly set. DataLoader is a follow-up
// once a list page surfaces a longer set.
// ============================================

export interface CommitteeBriefingItem {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  url?: string | null;
  description?: string | null;
  memberCount: number;
  relevanceExplanation?: string | null;
}

export interface PersonalizedCommitteesBriefingData {
  legislativeCommittees: {
    items: CommitteeBriefingItem[];
    total: number;
    hasMore: boolean;
  };
}

/**
 * Bulk committee query for the briefing surface. Asks for a generous
 * page (default 100) so client-side filtering can land top-N committees
 * whose `relevanceExplanation` is populated. The existing region query
 * is reused — we just request the new field added in #836.
 */
export const GET_BRIEFING_COMMITTEES = gql`
  query BriefingCommittees($take: Int) {
    legislativeCommittees(skip: 0, take: $take) {
      items {
        id
        externalId
        name
        chamber
        url
        description
        memberCount
        relevanceExplanation
      }
      total
      hasMore
    }
  }
`;

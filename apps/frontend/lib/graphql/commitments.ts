import { gql } from "@apollo/client";

/**
 * Mutation to record that the authenticated user acknowledged the
 * current published version of the ethical commitments (#754). The
 * users service rejects any `version` other than
 * `CURRENT_COMMITMENTS_VERSION` so a stale client cannot silently
 * skip a re-acknowledgement triggered by a version bump.
 *
 * Returns the updated `User` so the Apollo cache picks up the new
 * `commitmentsAcknowledgedAt` / `commitmentsVersionAcknowledged`
 * without an extra round-trip.
 */
export const ACKNOWLEDGE_COMMITMENTS = gql`
  mutation AcknowledgeCommitments($version: String!) {
    acknowledgeCommitments(version: $version) {
      id
      commitmentsAcknowledgedAt
      commitmentsVersionAcknowledged
    }
  }
`;

export interface AcknowledgeCommitmentsData {
  acknowledgeCommitments: {
    id: string;
    commitmentsAcknowledgedAt: string;
    commitmentsVersionAcknowledged: string;
  };
}

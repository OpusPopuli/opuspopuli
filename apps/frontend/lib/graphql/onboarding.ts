import { gql } from "@apollo/client";

/**
 * Mutation to mark first-run onboarding complete for the authenticated
 * user (#758). Server-side persistence is the source of truth so a
 * returning user on a new device/browser is not re-prompted — the
 * frontend reads `onboardingCompletedAt` back via the `myProfile`
 * query and treats localStorage only as a fast-path cache.
 *
 * Returns the updated profile so the Apollo cache picks up the new
 * `onboardingCompletedAt` without an extra round-trip.
 */
export const COMPLETE_ONBOARDING = gql`
  mutation CompleteOnboarding {
    completeOnboarding {
      id
      onboardingCompletedAt
    }
  }
`;

export interface CompleteOnboardingData {
  completeOnboarding: {
    id: string;
    onboardingCompletedAt: string;
  };
}

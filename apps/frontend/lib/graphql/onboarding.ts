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

/**
 * Read-back of the durable onboarding flag (#758). The mutation above is the
 * cross-device source of truth; localStorage is only a per-device cache. On a
 * device where the user never personally finished onboarding (e.g. they
 * onboarded on desktop, then opened the app on their phone), that cache is
 * empty — so anything gated on `hasCompletedOnboarding` (the scan FAB) stays
 * hidden until this query hydrates the cache from the server.
 */
export const GET_ONBOARDING_STATUS = gql`
  query OnboardingStatus {
    myProfile {
      id
      onboardingCompletedAt
    }
  }
`;

export interface OnboardingStatusData {
  myProfile: {
    id: string;
    onboardingCompletedAt: string | null;
  } | null;
}

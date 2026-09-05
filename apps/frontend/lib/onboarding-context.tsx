"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import {
  COMPLETE_ONBOARDING,
  CompleteOnboardingData,
  GET_ONBOARDING_STATUS,
  OnboardingStatusData,
} from "@/lib/graphql/onboarding";
import { useAuth } from "@/lib/auth-context";
import {
  GET_BRIEFING_PREFETCH,
  TRIGGER_MY_LLM_RERANK,
  type BriefingPrefetchData,
} from "@/lib/graphql/personalized-feed";

interface OnboardingContextType {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined,
);

const STORAGE_KEY = "opuspopuli_onboarding_completed";

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot(): boolean {
  return true;
}

function subscribe(callback: () => void): () => void {
  globalThis.addEventListener("storage", callback);
  return () => globalThis.removeEventListener("storage", callback);
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const hasCompletedOnboarding = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Hydrate the per-device localStorage cache from the durable server flag
  // (#758). localStorage is only a fast-path cache; the server's
  // `onboardingCompletedAt` is the cross-device source of truth. Without this
  // read-back, a user who onboarded on another device (e.g. desktop, then
  // opens the app on their phone) has an empty cache here, so
  // `hasCompletedOnboarding` is false and anything gated on it — the scan FAB
  // — never renders on that device.
  const { isAuthenticated } = useAuth();
  const { data: onboardingStatus } = useQuery<OnboardingStatusData>(
    GET_ONBOARDING_STATUS,
    { skip: !isAuthenticated },
  );
  useEffect(() => {
    if (
      onboardingStatus?.myProfile?.onboardingCompletedAt &&
      localStorage.getItem(STORAGE_KEY) !== "true"
    ) {
      localStorage.setItem(STORAGE_KEY, "true");
      globalThis.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY }),
      );
    }
  }, [onboardingStatus]);

  const [currentStep, setCurrentStep] = useState(0);
  // County, threshold, topics, veteran, expectations, commitments. Every step
  // owns its own primary action, and the commitments acknowledgement (#754)
  // is mandatory rather than skippable. Was 10, four of which were product
  // slides shown before a single question — see OnboardingSteps.
  const totalSteps = 6;

  // Server-side persistence of onboarding completion (#758). localStorage
  // stays the instant, offline-safe cache; the mutation is the durable,
  // cross-device source of truth. Fire-and-forget so navigation isn't
  // blocked on the round-trip — a failed write just leaves the server
  // flag unset, and the next completion (or the localStorage cache)
  // covers this device until then.
  const [persistOnboardingComplete] =
    useMutation<CompleteOnboardingData>(COMPLETE_ONBOARDING);

  const client = useApolloClient();

  /**
   * Generate this user's relevance explanations now, rather than at 03:00.
   *
   * Nothing used to trigger generation on sign-up — only the nightly cron and
   * a manual mutation. So a brand-new user finished onboarding, landed on
   * their briefing, and found the committees section empty and no
   * "why this matters to you" anywhere, until the next morning. The whole
   * point of the product, absent on the one visit that forms an impression.
   *
   * Fire-and-forget, matching `persistOnboardingComplete` above: the jobs run
   * in the background and the UI never waits on them. A failure just means
   * the cron fills the cache tonight, which is exactly the old behaviour.
   */
  const primePersonalization = useCallback(async () => {
    try {
      const { data } = await client.query<BriefingPrefetchData>({
        query: GET_BRIEFING_PREFETCH,
        // The signal profile was written moments ago by onboarding; a cached
        // read here would send the pre-onboarding flags and personalise to
        // the wrong person.
        fetchPolicy: "network-only",
      });

      const flags = data?.myRankingFlags;
      if (!flags) return;

      // Strip Apollo's __typename — GraphQL input objects reject unknown
      // fields, so leaving it in fails the whole mutation with a validation
      // error rather than anything descriptive.
      const { __typename, ...rankingFlags } = flags as typeof flags & {
        __typename?: string;
      };

      await client.mutate({
        mutation: TRIGGER_MY_LLM_RERANK,
        variables: {
          input: {
            interestTags: data?.mySignalProfile?.interestTags ?? [],
            flags: rankingFlags,
          },
        },
      });
    } catch {
      // Non-fatal by design — see above.
    }
  }, [client]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    globalThis.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    persistOnboardingComplete().catch(() => {
      // Non-fatal: localStorage already reflects completion on this
      // device; the server flag will catch up on a later completion.
    });
    void primePersonalization();
  }, [persistOnboardingComplete, primePersonalization]);

  const skipOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    globalThis.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    setCurrentStep(0);
  }, []);

  const nextStep = useCallback(
    () => setCurrentStep((s) => Math.min(s + 1, totalSteps - 1)),
    [totalSteps],
  );
  const prevStep = useCallback(
    () => setCurrentStep((s) => Math.max(s - 1, 0)),
    [],
  );

  const value = useMemo(
    () => ({
      hasCompletedOnboarding,
      currentStep,
      totalSteps,
      nextStep,
      prevStep,
      skipOnboarding,
      completeOnboarding,
      resetOnboarding,
    }),
    [
      hasCompletedOnboarding,
      currentStep,
      totalSteps,
      nextStep,
      prevStep,
      skipOnboarding,
      completeOnboarding,
      resetOnboarding,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}

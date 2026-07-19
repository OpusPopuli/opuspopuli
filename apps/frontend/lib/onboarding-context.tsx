"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useMutation } from "@apollo/client/react";
import {
  COMPLETE_ONBOARDING,
  CompleteOnboardingData,
} from "@/lib/graphql/onboarding";

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
  const [currentStep, setCurrentStep] = useState(0);
  // 5 marketing steps + 4 data-collection steps (address, topics,
  // life context, veteran) + 1 mandatory commitments acknowledgement
  // (#754). Data + commitments steps own their own submit buttons;
  // OnboardingSteps hides its global Next for those indices.
  const totalSteps = 10;

  // Server-side persistence of onboarding completion (#758). localStorage
  // stays the instant, offline-safe cache; the mutation is the durable,
  // cross-device source of truth. Fire-and-forget so navigation isn't
  // blocked on the round-trip — a failed write just leaves the server
  // flag unset, and the next completion (or the localStorage cache)
  // covers this device until then.
  const [persistOnboardingComplete] =
    useMutation<CompleteOnboardingData>(COMPLETE_ONBOARDING);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    globalThis.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    persistOnboardingComplete().catch(() => {
      // Non-fatal: localStorage already reflects completion on this
      // device; the server flag will catch up on a later completion.
    });
  }, [persistOnboardingComplete]);

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

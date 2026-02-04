"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useOnboarding } from "@/lib/onboarding-context";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { hasCompletedOnboarding } = useOnboarding();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
    if (!authLoading && hasCompletedOnboarding) {
      router.replace("/petition");
    }
  }, [authLoading, isAuthenticated, hasCompletedOnboarding, router]);

  if (authLoading || hasCompletedOnboarding) {
    return null;
  }

  return <OnboardingSteps />;
}

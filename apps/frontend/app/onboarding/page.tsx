"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@apollo/client/react";
import { useAuth } from "@/lib/auth-context";
import { useOnboarding } from "@/lib/onboarding-context";
import { GET_MY_PROFILE, MyProfileData } from "@/lib/graphql/profile";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { hasCompletedOnboarding } = useOnboarding();

  // The server flag is the cross-device source of truth (#758). A stale
  // localStorage cache — e.g. a `true` left by a different account that
  // previously onboarded in this browser — must NOT skip onboarding for
  // a genuinely new user, so once the query resolves the server value
  // wins outright. localStorage is only a fallback for when the API is
  // unreachable (offline / gateway down), so a returning user isn't
  // needlessly re-onboarded. Skip the query until we know the user is
  // authenticated (unauthenticated users are redirected to /login).
  const { data, loading } = useQuery<MyProfileData>(GET_MY_PROFILE, {
    skip: authLoading || !isAuthenticated,
  });

  const serverResolved = Boolean(data);
  const serverCompleted = Boolean(data?.myProfile?.onboardingCompletedAt);
  // Server authoritative once resolved; fall back to the local cache only
  // when the query failed to return (network/API error).
  const alreadyOnboarded = serverResolved
    ? serverCompleted
    : hasCompletedOnboarding;

  // Wait for auth and (when authenticated) either a resolved query or an
  // error before deciding, so a returning user never flashes onboarding.
  const isResolving = authLoading || (isAuthenticated && loading);

  useEffect(() => {
    if (isResolving) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (alreadyOnboarded) {
      router.replace("/me/briefing");
    }
  }, [isResolving, isAuthenticated, alreadyOnboarded, router]);

  if (isResolving || !isAuthenticated || alreadyOnboarded) {
    return null;
  }

  return <OnboardingSteps />;
}

"use client";

import { BillsBriefingSection } from "./bills/BillsBriefingSection";
import { BriefingGreeting } from "./BriefingGreeting";
import { CommitteesBriefingSection } from "./committees/CommitteesBriefingSection";
import { PropositionsBriefingSection } from "./propositions/PropositionsBriefingSection";
import { RepsBriefingSection } from "./reps/RepsBriefingSection";
import { useBriefingGreetingData } from "./useBriefingGreetingData";

/**
 * The authenticated home page. Composes the personalized greeting +
 * summary at the top (#849 Phase 1) and four BriefingSection cards —
 * Bills (#744), Reps (#769), Propositions (#771), Committees (#770
 * placeholder + #836 personalization).
 *
 * The greeting IS the page's primary heading — there's no separate
 * "Your Civic Briefing" h1 anymore. The static title was a generic
 * placeholder; the personalized greeting ("Good evening, Rodney")
 * does the same job with more warmth and less repetition. The
 * "Browse all civic data →" link moves into the greeting block.
 *
 * Phase 2 will swap the deterministic template inside the greeting
 * for an LLM-polished version with activity context.
 *
 * Each section owns its own loading / empty / error / no-profile
 * branches so the page composes without a top-level Suspense boundary.
 */
export function BriefingPage() {
  const greeting = useBriefingGreetingData();
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <BriefingGreeting
        firstName={greeting.firstName}
        counts={greeting.counts}
        urgentBillCount={greeting.urgentBillCount}
      />
      <div className="space-y-5">
        <BillsBriefingSection />
        <RepsBriefingSection />
        <CommitteesBriefingSection />
        <PropositionsBriefingSection />
      </div>
    </main>
  );
}

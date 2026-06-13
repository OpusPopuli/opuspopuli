"use client";

import { BillsBriefingSection } from "./bills/BillsBriefingSection";
import { BriefingPageHeader } from "./BriefingPageHeader";
import { CommitteesBriefingSection } from "./committees/CommitteesBriefingSection";
import { PropositionsBriefingSection } from "./propositions/PropositionsBriefingSection";
import { RepsBriefingSection } from "./reps/RepsBriefingSection";

/**
 * The authenticated home page. Composes the page header (with the
 * "Browse all civic data →" link to /region) and four BriefingSection
 * cards — Bills (#744), Reps (#769), Propositions (#771), Committees
 * (#770 placeholder + #836 personalization).
 *
 * Each section owns its own loading / empty / error / no-profile
 * branches so the page composes without a top-level Suspense boundary.
 */
export function BriefingPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <BriefingPageHeader />
      <div className="space-y-5">
        <BillsBriefingSection />
        <RepsBriefingSection />
        <CommitteesBriefingSection />
        <PropositionsBriefingSection />
      </div>
    </main>
  );
}

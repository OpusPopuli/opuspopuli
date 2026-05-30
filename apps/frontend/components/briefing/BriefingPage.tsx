"use client";

import { BillsBriefingSection } from "./bills/BillsBriefingSection";
import { BriefingPageHeader } from "./BriefingPageHeader";
import { CommitteesBriefingPlaceholder } from "./placeholders/CommitteesBriefingPlaceholder";
import { PropositionsBriefingPlaceholder } from "./placeholders/PropositionsBriefingPlaceholder";
import { RepsBriefingPlaceholder } from "./placeholders/RepsBriefingPlaceholder";

/**
 * The authenticated home page. Composes the page header (with the
 * "Browse all civic data →" link to /region) and four BriefingSection
 * cards — Bills (the AC of #744) plus the three placeholder sections
 * for Reps, Committees, Propositions whose personalized variants land
 * via #769 / #770 / #771.
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
        <RepsBriefingPlaceholder />
        <CommitteesBriefingPlaceholder />
        <PropositionsBriefingPlaceholder />
      </div>
    </main>
  );
}

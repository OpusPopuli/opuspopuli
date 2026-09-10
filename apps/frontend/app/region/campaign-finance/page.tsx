"use client";

import Link from "next/link";
import { RegionPageHeader } from "@/components/region/RegionPageHeader";

import { FinanceDisclaimer } from "@/components/region/FinanceDisclaimer";

const CAMPAIGN_FINANCE_CARDS = [
  {
    title: "Committees",
    description: "Campaign committees and PACs",
    href: "/region/campaign-finance/committees",
  },
  {
    title: "Contributions",
    description: "Campaign donations and contributions",
    href: "/region/campaign-finance/contributions",
  },
  {
    title: "Expenditures",
    description: "Campaign spending and payments",
    href: "/region/campaign-finance/expenditures",
  },
  {
    title: "Independent Expenditures",
    description: "Independent spending for/against candidates",
    href: "/region/campaign-finance/independent-expenditures",
  },
];

export default function CampaignFinancePage() {
  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      <RegionPageHeader
        segments={[{ label: "Campaign Finance" }]}
        title="Campaign Finance"
        meta="Committees, contributions, and expenditures for your region"
      />

      {/* Sub-category Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {CAMPAIGN_FINANCE_CARDS.map((card) => (
          <Link
            key={card.href}
            // prefetch-ok: four static sub-category routes, not per-item
            href={card.href}
            className="group bg-surface rounded-lg p-6 transition-all duration-200"
          >
            <h2 className="text-lg font-semibold text-content group-hover:text-info-strong transition-colors">
              {card.title}
            </h2>
            <p className="mt-1 text-sm text-content-dim">{card.description}</p>
          </Link>
        ))}
      </div>

      <FinanceDisclaimer className="mt-8" />
    </div>
  );
}

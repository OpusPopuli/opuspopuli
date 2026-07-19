"use client";

import Link from "next/link";

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
      {/* Breadcrumb */}
      <nav className="mb-6">
        <Link
          href="/region"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Region
        </Link>
        <span className="mx-2 text-content-dim">/</span>
        <span className="text-sm text-content-dim">Campaign Finance</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content">Campaign Finance</h1>
        <p className="mt-2 text-content-dim">
          Committees, contributions, and expenditures for your region
        </p>
      </div>

      {/* Sub-category Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {CAMPAIGN_FINANCE_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group bg-surface rounded-lg p-6 transition-all duration-200"
          >
            <h2 className="text-lg font-semibold text-content group-hover:text-blue-600 transition-colors">
              {card.title}
            </h2>
            <p className="mt-1 text-sm text-content-dim">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

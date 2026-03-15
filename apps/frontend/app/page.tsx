import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { FeatureCard } from "@/components/landing/FeatureCard";

export const metadata: Metadata = {
  title: {
    absolute: "OPUS - Civic Engagement Platform | Opus Populi",
  },
};

function BallotIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function CurrencyIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-8 pt-20 pb-16 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-[#222222] dark:text-white mb-6 leading-tight">
            Know your ballot.
            <br />
            Hold power accountable.
          </h1>
          <p className="text-lg text-[#4d4d4d] dark:text-gray-300 max-w-2xl mx-auto mb-10">
            Transparent access to propositions, representatives, campaign
            finance, and petition tracking — powered by AI, built for citizens.
          </p>
          <LandingCTA />
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-8 pb-20">
          <h2 className="text-2xl font-bold text-[#222222] dark:text-white text-center mb-12">
            Everything you need to stay informed
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<BallotIcon />}
              title="Ballot & Propositions"
              description="Track ballot measures and initiatives in your region. Get AI-powered analysis to understand what you're voting on."
              href="/region/propositions"
            />
            <FeatureCard
              icon={<CameraIcon />}
              title="Petition Scanner"
              description="Scan petitions with your camera for instant AI verification. Track signature progress on an interactive map."
              href="/petition"
            />
            <FeatureCard
              icon={<UsersIcon />}
              title="Representatives & Meetings"
              description="Know who represents you. Follow public meetings, legislative sessions, and committee hearings."
              href="/region/representatives"
            />
            <FeatureCard
              icon={<CurrencyIcon />}
              title="Campaign Finance"
              description="Follow the money. Explore contributions, expenditures, and committee spending with full transparency."
              href="/region/campaign-finance"
            />
          </div>
        </section>

        {/* Trust Signals */}
        <section className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="max-w-6xl mx-auto px-8 py-20">
            <h2 className="text-2xl font-bold text-[#222222] dark:text-white text-center mb-12">
              Built on trust and transparency
            </h2>
            <div className="grid gap-8 sm:grid-cols-3">
              <Link href="/transparency" className="text-center group">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mx-auto mb-4 text-blue-600 dark:text-blue-400">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-[#222222] dark:text-white mb-2 group-hover:text-[#5A7A6A] transition-colors">
                  AI Transparency
                </h3>
                <p className="text-sm text-[#4d4d4d] dark:text-gray-300">
                  Our AI commitments, system cards, and prompt charter are
                  public. You always know how AI is used.
                </p>
              </Link>

              <Link href="/privacy" className="text-center group">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-[#222222] dark:text-white mb-2 group-hover:text-[#5A7A6A] transition-colors">
                  Privacy First
                </h3>
                <p className="text-sm text-[#4d4d4d] dark:text-gray-300">
                  GDPR and CCPA compliant. You control your data with granular
                  consent management and full data export.
                </p>
              </Link>

              <div className="text-center">
                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mx-auto mb-4 text-purple-600 dark:text-purple-400">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-[#222222] dark:text-white mb-2">
                  Open Source
                </h3>
                <p className="text-sm text-[#4d4d4d] dark:text-gray-300">
                  Our platform is open source. Inspect the code, contribute, and
                  help build better civic tools.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

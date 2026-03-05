import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Prompt Service Charter | Opus Populi",
  description:
    "How Opus Populi designs, manages, and verifies AI prompts for neutrality and completeness.",
};

export default function PromptCharterPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-8 py-12">
        <div className="mb-6">
          <Link
            href="/transparency"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            &larr; Back to Transparency
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Prompt Service Charter
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: March 2026
        </p>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              1. What Prompts Do
            </h2>
            <p className="mb-3">
              Prompts are structured instructions given to AI models that shape
              how they analyze documents. In Opus Populi, prompts define:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                What information to extract from a document (key provisions,
                entities, fiscal impacts).
              </li>
              <li>
                How to structure the output (summary, key points, impact
                analysis).
              </li>
              <li>
                What standards to apply (neutrality, completeness, source
                fidelity).
              </li>
              <li>
                What constraints to enforce (no recommendations, no partisan
                language).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              2. Design Principles
            </h2>
            <p className="mb-4">
              Every prompt in the Opus Populi system is governed by four core
              principles:
            </p>

            <div className="space-y-4">
              <div className="pl-4 border-l-2 border-blue-500">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Neutrality
                </h3>
                <p className="text-sm">
                  Prompts never include partisan language, leading questions, or
                  instructions that could steer the AI toward a particular
                  conclusion. The AI is directed to present facts and
                  implications, not opinions.
                </p>
              </div>

              <div className="pl-4 border-l-2 border-blue-500">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Completeness
                </h3>
                <p className="text-sm">
                  Prompts require the AI to address all substantive provisions
                  in a document, not cherry-pick favorable or unfavorable
                  elements. Data completeness scores are provided so users can
                  see when information is missing.
                </p>
              </div>

              <div className="pl-4 border-l-2 border-blue-500">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Source Attribution
                </h3>
                <p className="text-sm">
                  Every claim in an analysis must be traceable to the source
                  document or a disclosed data source. The AI must not introduce
                  information that is not present in or directly derivable from
                  the inputs.
                </p>
              </div>

              <div className="pl-4 border-l-2 border-blue-500">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Transparency
                </h3>
                <p className="text-sm">
                  Prompt versions and cryptographic hashes are published with
                  every analysis result. Users can detect when prompts change
                  and verify consistency across analyses.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              3. How Prompts Are Managed
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Prompts are stored in a <strong>private repository</strong>,
                separate from the open-source application code.
              </li>
              <li>
                Every prompt change goes through code review before deployment.
              </li>
              <li>
                Each prompt version is assigned a{" "}
                <strong>semantic version number</strong> (e.g., v2.1.0).
              </li>
              <li>
                A <strong>SHA-256 cryptographic hash</strong> is computed at
                deployment time and embedded in every analysis result.
              </li>
              <li>
                Prompts are served via a centralized prompt service with
                authenticated API access &mdash; individual nodes in a federated
                deployment cannot modify prompts.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              4. Verification and Auditability
            </h2>
            <p className="mb-3">We design for auditability at every level:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Every analysis result includes the <strong>prompt hash</strong>{" "}
                used to generate it. Users can compare hashes across analyses to
                detect prompt changes.
              </li>
              <li>
                The{" "}
                <Link
                  href="/transparency/system-card"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  System Card
                </Link>{" "}
                changelog documents all prompt version updates.
              </li>
              <li>
                Data sources contributing to each analysis are disclosed with
                freshness indicators so users can assess data quality.
              </li>
              <li>
                Users can report issues with any analysis through the in-app
                reporting mechanism, triggering a review of the relevant prompt.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              5. What We Do Not Disclose
            </h2>
            <p className="mb-3">
              The exact text of our prompts is proprietary. We do not publish
              prompt templates because:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Publishing exact prompts would allow bad actors to craft
                documents specifically designed to manipulate or evade the
                analysis pipeline.
              </li>
              <li>
                Prompt engineering is a key part of our value proposition and
                intellectual property.
              </li>
              <li>
                The principles, constraints, and verification mechanisms
                described above provide meaningful transparency without
                compromising system integrity.
              </li>
            </ul>
            <p className="mt-3">
              We believe this approach balances transparency with security
              &mdash; you can verify <em>what</em> the AI is constrained to do
              and <em>how</em> those constraints are enforced, without exposing
              implementation details that could be exploited.
            </p>
          </section>

          <section className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              See also:{" "}
              <Link
                href="/transparency/system-card"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                AI System Card
              </Link>
              {" \u00B7 "}
              <Link
                href="/transparency/ai-commitments"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                AI Commitments
              </Link>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

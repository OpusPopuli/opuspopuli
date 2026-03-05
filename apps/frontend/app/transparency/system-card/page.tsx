import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "AI System Card | Opus Populi",
  description:
    "How Opus Populi's AI system works, what data it processes, its limitations, and how to report issues.",
};

export default function SystemCardPage() {
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
          AI System Card
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: March 2026
        </p>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              1. What the AI Does
            </h2>
            <p className="mb-3">
              Opus Populi uses AI to help citizens understand civic documents
              such as petitions, ballot measures, and legislative proposals. The
              AI performs:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Text extraction:</strong> Reads scanned documents using
                optical character recognition (OCR).
              </li>
              <li>
                <strong>Summarization:</strong> Produces plain-language
                summaries of complex legal and legislative text.
              </li>
              <li>
                <strong>Impact analysis:</strong> Identifies who benefits, who
                may be affected, and potential concerns.
              </li>
              <li>
                <strong>Entity extraction:</strong> Identifies organizations,
                agencies, and officials mentioned in the document.
              </li>
            </ul>
            <p className="mt-3 font-medium">
              The AI performs analysis only. It never makes voting
              recommendations or endorses political positions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              2. Data Processed
            </h2>
            <p className="mb-3">
              The AI processes only documents that users explicitly upload or
              scan:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Petition images captured through the in-app camera scanner.
              </li>
              <li>Uploaded PDF or text documents submitted for analysis.</li>
            </ul>
            <p className="mt-3">
              Document content is stored only for the purpose of providing
              analysis results. We do not use uploaded documents to train or
              fine-tune AI models. See our{" "}
              <Link
                href="/transparency/ai-commitments"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                AI Commitments
              </Link>{" "}
              for binding guarantees.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              3. Training Data and Models
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                We use pre-trained, open-source large language models served
                through Ollama (e.g., Llama, Mistral).
              </li>
              <li>
                <strong>No fine-tuning</strong> is performed on user data or
                Opus Populi content.
              </li>
              <li>
                Model provider and version are disclosed with every analysis
                result (e.g., &quot;Analyzed by Ollama (llama3.2)&quot;).
              </li>
              <li>
                Models are selected for their ability to follow structured
                extraction instructions reliably.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              4. Prompt Architecture
            </h2>
            <p className="mb-3">
              Prompts are the instructions given to the AI that shape how it
              analyzes documents. Our prompt system is designed for
              auditability:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Every prompt is <strong>versioned</strong> with a semantic
                version number.
              </li>
              <li>
                Every prompt is <strong>cryptographically hashed</strong>{" "}
                (SHA-256) at deployment time.
              </li>
              <li>
                Each analysis result includes the prompt hash so users can
                detect when prompts change.
              </li>
              <li>
                Prompts are served from a centralized, private prompt service
                &mdash; they cannot be modified by individual nodes in a
                federated deployment.
              </li>
            </ul>
            <p className="mt-3">
              For more detail on our prompt methodology, see the{" "}
              <Link
                href="/transparency/prompt-charter"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Prompt Service Charter
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              5. Known Limitations
            </h2>
            <p className="mb-3">
              Like all AI systems, ours has limitations. Users should be aware
              that the AI:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                May miss nuance in complex legal language, particularly in
                lengthy or highly technical documents.
              </li>
              <li>
                May not catch all fiscal or budgetary implications if they are
                not explicitly stated in the document.
              </li>
              <li>
                Depends on the quality of the source text &mdash; poor scans or
                OCR errors reduce analysis accuracy.
              </li>
              <li>
                Cannot evaluate political feasibility or predict real-world
                outcomes of proposed measures.
              </li>
              <li>
                May produce different results for the same document if the
                prompt version or model changes.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              6. Failure Modes
            </h2>
            <p className="mb-3">
              When the AI cannot produce a confident analysis, it communicates
              this transparently:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Confidence scores</strong> are displayed with every OCR
                extraction so users can judge text quality.
              </li>
              <li>
                <strong>Data completeness indicators</strong> show what
                percentage of ideal data sources were available for the
                analysis.
              </li>
              <li>
                The AI will surface missing data points rather than silently
                omitting them.
              </li>
              <li>
                Users are always encouraged to read the original source document
                alongside any AI analysis.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              7. Abuse Reporting
            </h2>
            <p className="mb-3">
              If you encounter an AI analysis that is incorrect, misleading,
              offensive, or otherwise problematic:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Use the <strong>&quot;Report Issue&quot;</strong> button on any
                analysis results page to submit a report directly.
              </li>
              <li>
                Reports are reviewed by our team and used to improve prompt
                quality and identify failure patterns.
              </li>
              <li>
                You can also contact us at{" "}
                <a
                  href="mailto:transparency@opuspopuli.org"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  transparency@opuspopuli.org
                </a>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              8. Changelog
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 pr-4 font-semibold text-gray-900 dark:text-white">
                      Version
                    </th>
                    <th className="text-left py-2 pr-4 font-semibold text-gray-900 dark:text-white">
                      Date
                    </th>
                    <th className="text-left py-2 font-semibold text-gray-900 dark:text-white">
                      Changes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-4">v1.0</td>
                    <td className="py-2 pr-4">March 2026</td>
                    <td className="py-2">Initial system card publication.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              See also:{" "}
              <Link
                href="/transparency/ai-commitments"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                AI Commitments
              </Link>
              {" \u00B7 "}
              <Link
                href="/transparency/prompt-charter"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Prompt Service Charter
              </Link>
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

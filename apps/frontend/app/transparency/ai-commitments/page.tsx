import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "AI Commitments | Opus Populi",
  description:
    "What Opus Populi's AI will never do \u2014 binding commitments with technical controls and verification methods.",
};

const commitments = [
  {
    title: "Never Make Voting Recommendations",
    commitment:
      "The AI will never suggest how to vote on any measure, candidate, or issue. It provides analysis to inform your own decision.",
    control:
      "Prompt templates are constrained to analytical output only. No recommendation, endorsement, or persuasive language is permitted in prompt instructions.",
    verify:
      "Review any analysis output \u2014 you will find summaries, key points, and impact assessments, but never a recommendation on how to vote.",
  },
  {
    title: "Never Suppress or Promote Political Positions",
    commitment:
      "The AI presents all perspectives found in the source document without favoring or suppressing any political viewpoint.",
    control:
      "Prompts are tested against bias benchmarks. Instructions explicitly require the AI to include all provisions and viewpoints from the source text.",
    verify:
      "Compare any analysis against the original source document. All substantive provisions should be represented.",
  },
  {
    title: "Never Store Prompt Templates in Client Code",
    commitment:
      "All AI prompts live in a private, centralized prompt service. The open-source codebase never contains prompt text.",
    control:
      "Prompts are served via authenticated API calls at analysis time. The prompt service is a separate, private repository.",
    verify:
      "Inspect the open-source codebase on GitHub \u2014 you will find prompt service API calls but no prompt template text.",
  },
  {
    title: "Never Train on User Documents",
    commitment:
      "User-uploaded documents are never used to train or fine-tune AI models. We use only pre-trained, open-source models.",
    control:
      "No fine-tuning pipeline exists in our infrastructure. Models are downloaded pre-trained and used as-is for inference only.",
    verify:
      "Our architecture documentation and open-source code confirm there is no training pipeline. Model versions are disclosed per analysis.",
  },
  {
    title: "Never Share Data Between Federated Nodes Without Consent",
    commitment:
      "In federated deployments, each node operates in isolation. No user data crosses node boundaries without explicit user action.",
    control:
      "Node-to-node communication is restricted to configuration sync. User data storage is local to each node with no cross-node replication.",
    verify:
      "Network architecture is documented in the open-source repository. Node isolation can be verified through configuration inspection.",
  },
  {
    title: "Never Sell or Monetize User Data",
    commitment:
      "We will never sell, license, or otherwise monetize user data. We have no ad-tech integrations and no data broker relationships.",
    control:
      "No advertising SDKs, tracking pixels, or data export pipelines exist in our codebase. Third-party services are limited to infrastructure providers.",
    verify:
      "Review our third-party service list in the Privacy Policy and inspect the open-source codebase for the absence of ad-tech integrations.",
  },
];

export default function AICommitmentsPage() {
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
          AI Commitments
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          These are binding commitments &mdash; not aspirations. Each commitment
          is backed by a technical control that you can verify.
        </p>

        <div className="space-y-6">
          {commitments.map((item) => (
            <div
              key={item.title}
              className="bg-white dark:bg-gray-800 rounded-lg shadow p-6"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                {item.title}
              </h2>
              <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <p>
                  <strong>Commitment:</strong> {item.commitment}
                </p>
                <p>
                  <strong>Technical Control:</strong> {item.control}
                </p>
                <p>
                  <strong>How to Verify:</strong> {item.verify}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
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
              href="/transparency/prompt-charter"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Prompt Service Charter
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

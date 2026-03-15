import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Transparency | Opus Populi",
  description:
    "Learn how Opus Populi's AI works, what commitments we make, and how our prompts are designed and verified.",
};

const pages = [
  {
    href: "/transparency/system-card",
    title: "AI System Overview",
    description:
      "How our AI works, what data it processes, and its known limitations.",
  },
  {
    href: "/transparency/ai-commitments",
    title: "AI Commitments",
    description:
      "What this AI will never do \u2014 our binding commitments and their technical controls.",
  },
  {
    href: "/transparency/prompt-charter",
    title: "Prompt Service Charter",
    description:
      "How our prompts are designed, managed, and verified for neutrality.",
  },
];

export default function TransparencyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 max-w-4xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Transparency
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Opus Populi is committed to AI transparency. We believe you have the
          right to understand how our AI analyzes documents, what commitments
          govern its behavior, and how we verify its neutrality.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="group block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition-shadow"
            >
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {page.title}
              </h2>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                {page.description}
              </p>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}

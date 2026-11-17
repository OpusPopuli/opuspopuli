import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PromptRecordView } from "@/components/ai/PromptRecordView";
import { loadPromptRecord } from "@/lib/prompt-record";

export const metadata: Metadata = {
  title: "Published prompt | Opus Populi",
  description:
    "The exact prompt an AI-written passage on Opus Populi was produced from, and how to check it yourself.",
};

/**
 * Where every receipt's prompt link lands (#1450): the published text behind
 * a prompt fingerprint, read from prompt-service's public attestation record
 * and checked against the fingerprint before it is shown.
 *
 * The server only loads; `PromptRecordView` renders, so the page's words go
 * through react-i18next like the rest of the site.
 */
export default async function PromptRecordPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  const record = await loadPromptRecord(hash);
  return (
    <div className="min-h-screen bg-surface-alt flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-12">
        <PromptRecordView record={record} />
      </main>
      <Footer />
    </div>
  );
}

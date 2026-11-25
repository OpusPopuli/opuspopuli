import type { Metadata } from "next";
import { civicMetadata } from "@/lib/server/civic-metadata";

/**
 * Server-side metadata for a client page (#1456): what a search result or a
 * shared link shows. The page renders as before.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return civicMetadata("bill", id);
}

export default function BillLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

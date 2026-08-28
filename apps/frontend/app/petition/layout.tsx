"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";

/**
 * Auth only. The camera shell moved to `capture/layout.tsx` (#1075) — it was
 * wrapping the entire subtree, so the landing page, the results page and the
 * map all inherited a full-bleed black box with no header and no theme
 * response. Only the viewfinder should look like a viewfinder.
 */
export default function PetitionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

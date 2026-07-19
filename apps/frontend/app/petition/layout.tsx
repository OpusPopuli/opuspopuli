"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function PetitionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      {/* The on-ink class marks this a fixed-dark (camera) surface so the
          semantic tokens resolve to their inverse treatment. Without it,
          nested text-content-dim stays the light-theme dim (#726e66) and
          fails WCAG contrast on the black background. */}
      <div className="fixed inset-0 bg-black on-ink">{children}</div>
    </ProtectedRoute>
  );
}

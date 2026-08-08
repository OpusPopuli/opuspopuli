"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function PetitionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      {/* on-fixed-dark, not on-ink: the camera feed is black in both themes.
          on-ink INVERTS in dark theme (to a paper panel), which would put ink
          text on the black video. on-fixed-dark pins the tokens instead. */}
      <div className="fixed inset-0 bg-black on-fixed-dark">{children}</div>
    </ProtectedRoute>
  );
}

"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function PetitionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      <div className="fixed inset-0 bg-black">{children}</div>
    </ProtectedRoute>
  );
}

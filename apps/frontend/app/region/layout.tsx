"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/Header";

export default function RegionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      <Header />
      {children}
    </ProtectedRoute>
  );
}

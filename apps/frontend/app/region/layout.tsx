"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/Header";
import { CivicsProvider } from "@/components/civics/CivicsContext";

export default function RegionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      <Header />
      <CivicsProvider>{children}</CivicsProvider>
    </ProtectedRoute>
  );
}

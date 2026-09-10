"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CivicsProvider } from "@/components/civics/CivicsContext";
import { JurisdictionsProvider } from "@/components/region/JurisdictionsContext";

export default function RegionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute>
      <Header />
      <JurisdictionsProvider>
        <CivicsProvider>{children}</CivicsProvider>
      </JurisdictionsProvider>
      <Footer />
    </ProtectedRoute>
  );
}

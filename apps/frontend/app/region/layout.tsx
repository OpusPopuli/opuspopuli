"use client";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CivicsProvider } from "@/components/civics/CivicsContext";
import { JurisdictionsProvider } from "@/components/region/JurisdictionsContext";

/**
 * The civic record, open to everyone (#1456).
 *
 * There is no ProtectedRoute here on purpose. Every civic read the region
 * pages make is public on the server; only location needed the account, and
 * a visitor now sets that on their own device (`JurisdictionsProvider`).
 * Personal features stay behind sign-in: `/petition` and `/me/briefing`
 * keep their own guards, and the region pages offer an account where it
 * adds something (`AccountPrompt`), never as a wall.
 */
export default function RegionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      <JurisdictionsProvider>
        <CivicsProvider>{children}</CivicsProvider>
      </JurisdictionsProvider>
      <Footer />
    </>
  );
}

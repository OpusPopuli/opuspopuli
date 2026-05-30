"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/**
 * The civic-briefing home shares the same chrome as /region/* —
 * Header at top, Footer at bottom, ProtectedRoute auth-guard. The
 * /me/profile page uses the SettingsShellLayout because the sidebar
 * makes sense for "all the user-data tabs"; the briefing home is the
 * landing destination, not a settings tab, so it wears the same
 * lightweight chrome as the rest of the public-facing app.
 */
export default function MeBriefingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ProtectedRoute>
      <Header />
      {children}
      <Footer />
    </ProtectedRoute>
  );
}

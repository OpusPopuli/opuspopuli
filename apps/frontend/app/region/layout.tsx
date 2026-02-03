"use client";

import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function RegionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

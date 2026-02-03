"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Optional custom redirect path. Defaults to /login */
  redirectTo?: string;
}

/**
 * ProtectedRoute component that redirects unauthenticated users to login.
 *
 * Wrap protected pages or layouts with this component to enforce authentication.
 * The original URL is preserved in the redirect query param so users can be
 * returned after logging in.
 *
 * @example
 * ```tsx
 * // In a layout.tsx
 * export default function SettingsLayout({ children }) {
 *   return <ProtectedRoute>{children}</ProtectedRoute>;
 * }
 * ```
 */
export function ProtectedRoute({
  children,
  redirectTo = "/login",
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Preserve the original URL so we can redirect back after login
      const redirectUrl = `${redirectTo}?redirect=${encodeURIComponent(pathname)}`;
      router.replace(redirectUrl);
    }
  }, [isAuthenticated, isLoading, router, pathname, redirectTo]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e293b] mx-auto mb-4" />
          <p className="text-[#64748b]">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render children if not authenticated (redirect will happen)
  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

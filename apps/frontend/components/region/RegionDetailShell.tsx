"use client";

import { ReactNode } from "react";
import { LoadingSkeleton, ErrorState } from "@/components/region/ListStates";

interface RegionDetailShellProps {
  /** Whether the query is loading */
  loading: boolean;
  /** Error from the query, if any */
  error: unknown;
  /** The entity name for error messages (e.g. "proposition", "representative") */
  entity: string;
  /** Whether the data resolved to null/undefined (not found) */
  notFound: boolean;
  /** Content to show when not found */
  notFoundContent: ReactNode;
  /** Main content rendered when data is available */
  children: ReactNode;
}

/**
 * Shared loading/error/not-found shell for region detail pages
 * (legislative-committees/[id], propositions/[id], representatives/[id]).
 * Eliminates the repeated loading skeleton + error state + not-found card pattern.
 */
export function RegionDetailShell({
  loading,
  error,
  entity,
  notFound,
  notFoundContent,
  children,
}: RegionDetailShellProps) {
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <LoadingSkeleton count={1} height="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">
        <ErrorState entity={entity} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-12">{notFoundContent}</div>
    );
  }

  return <>{children}</>;
}

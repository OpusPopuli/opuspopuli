"use client";

interface SettingsLoadingSkeletonProps {
  /** Number of skeleton rows to show (default 4) */
  rows?: number;
  /** Height class for each row (default "h-16") */
  rowHeight?: string;
}

/**
 * Shared loading skeleton for settings pages (notifications, privacy, addresses).
 */
export function SettingsLoadingSkeleton({
  rows = 4,
  rowHeight = "h-16",
}: SettingsLoadingSkeletonProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="space-y-3 mt-8">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className={`${rowHeight} bg-gray-200 rounded`}></div>
          ))}
        </div>
      </div>
    </div>
  );
}

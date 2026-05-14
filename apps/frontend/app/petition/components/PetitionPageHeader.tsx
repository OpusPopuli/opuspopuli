"use client";

import { useRouter } from "next/navigation";

interface PetitionPageHeaderProps {
  readonly title: string;
  readonly backLabel: string;
  readonly backHref?: string;
}

/**
 * Sticky back-navigation header shared by petition sub-pages
 * (results, history, etc.).
 */
export function PetitionPageHeader({
  title,
  backLabel,
  backHref = "/petition",
}: PetitionPageHeaderProps) {
  const router = useRouter();

  return (
    <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm px-4 py-4 flex items-center gap-3 border-b border-gray-800">
      <button
        onClick={() => router.push(backHref)}
        className="text-gray-400 hover:text-white transition-colors"
        aria-label={backLabel}
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <h1 className="text-lg font-semibold text-white">{title}</h1>
    </div>
  );
}

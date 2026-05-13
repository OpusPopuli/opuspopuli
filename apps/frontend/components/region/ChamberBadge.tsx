"use client";

interface ChamberBadgeProps {
  readonly chamber: string;
}

/**
 * Badge showing Assembly or Senate chamber.
 * Shared by legislative-committees/page.tsx and
 * legislative-committees/[id]/page.tsx.
 */
export function ChamberBadge({ chamber }: ChamberBadgeProps) {
  const isAssembly = chamber === "Assembly";
  const cls = isAssembly
    ? "bg-blue-100 text-blue-800"
    : "bg-purple-100 text-purple-800";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {chamber}
    </span>
  );
}

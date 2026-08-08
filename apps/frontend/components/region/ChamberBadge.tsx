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
  // Chamber is a category, not a status — categorical ramp, not info/danger.
  const cls = isAssembly
    ? "bg-cat-blue-surface text-cat-blue"
    : "bg-cat-purple-surface text-cat-purple";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {chamber}
    </span>
  );
}

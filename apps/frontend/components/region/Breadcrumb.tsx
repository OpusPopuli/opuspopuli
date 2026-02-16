import Link from "next/link";

export interface BreadcrumbSegment {
  readonly label: string;
  readonly href?: string;
}

export function Breadcrumb({
  segments,
}: {
  readonly segments: BreadcrumbSegment[];
}) {
  return (
    <nav className="mb-6">
      {segments.map((segment, i) => (
        <span key={segment.label}>
          {i > 0 && <span className="mx-2 text-[#555555]">/</span>}
          {segment.href ? (
            <Link
              href={segment.href}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              {segment.label}
            </Link>
          ) : (
            <span className="text-sm text-[#555555]">{segment.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

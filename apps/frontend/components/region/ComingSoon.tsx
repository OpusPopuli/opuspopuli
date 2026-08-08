/**
 * Placeholder card for data that isn't yet available but is part
 * of the planned UI. Keeps the layout skeleton honest about future
 * content rather than silently omitting sections.
 */
export function ComingSoon({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="bg-surface-alt border border-dashed border-line rounded-lg p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-content-dim mb-1">
        {title}
      </p>
      <p className="text-sm text-content">{description}</p>
    </div>
  );
}

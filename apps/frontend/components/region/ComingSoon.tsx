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
    <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
        {title}
      </p>
      <p className="text-sm text-slate-700">{description}</p>
    </div>
  );
}

/**
 * Section title used across progressive-layer detail pages
 * (propositions, representatives). Matches the visual language
 * of the small-caps tracking-[1.5px] headings.
 */
export function SectionTitle({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-[1.5px] text-content-dim mb-3">
      {children}
    </h3>
  );
}

/**
 * Depth selector used on progressive-layer detail pages. Renders a
 * horizontal list of labeled dots. The current layer's dot + label
 * render in the active ink (#222222); others render muted.
 *
 * Takes the layer list as a prop so each detail page (propositions,
 * representatives, ...) can declare its own layer labels without
 * the component needing to know the domain.
 */
export interface LayerDefinition {
  readonly n: number;
  readonly label: string;
}

export function LayerNav({
  layers,
  current,
  onChange,
}: {
  readonly layers: readonly LayerDefinition[];
  readonly current: number;
  readonly onChange: (layer: number) => void;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-4 mb-8"
      aria-label="Information depth"
    >
      {layers.map(({ n, label }) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`flex items-center gap-2 text-sm font-medium transition-colors ${
            current === n
              ? "text-[#222222]"
              : "text-[#595959] hover:text-[#444444]"
          }`}
          aria-current={current === n ? "step" : undefined}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              current === n ? "bg-[#222222]" : "bg-[#767676]"
            }`}
          />
          {label}
        </button>
      ))}
    </nav>
  );
}

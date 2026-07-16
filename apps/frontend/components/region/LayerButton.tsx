/**
 * Action button used to advance through progressive layers on detail
 * pages. Primary variant is filled dark; secondary is bordered white
 * (used for "Back to Summary" etc.).
 */
export function LayerButton({
  onClick,
  variant = "primary",
  children,
}: {
  readonly onClick: () => void;
  readonly variant?: "primary" | "secondary";
  readonly children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        variant === "primary"
          ? "px-6 py-3 bg-inverse-surface text-on-inverse rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
          : "px-5 py-2.5 bg-surface text-content border-2 border-line rounded-lg font-semibold text-sm hover:border-content transition-colors"
      }
    >
      {children}
    </button>
  );
}

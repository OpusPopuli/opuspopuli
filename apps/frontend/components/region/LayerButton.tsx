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
          ? "px-6 py-3 bg-gray-900 text-white rounded-lg font-semibold text-sm hover:bg-gray-800 transition-colors"
          : "px-5 py-2.5 bg-white text-gray-900 border-2 border-gray-200 rounded-lg font-semibold text-sm hover:border-gray-900 transition-colors"
      }
    >
      {children}
    </button>
  );
}

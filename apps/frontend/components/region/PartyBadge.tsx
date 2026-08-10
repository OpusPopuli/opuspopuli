// Party colour is data encoding, so it uses the categorical ramp — never the
// status ramp. "Republican" must not render in the same red the app uses for
// errors, and "Green" must not render in the success green.
const PARTY_COLORS: Record<string, { bg: string; text: string }> = {
  Democrat: { bg: "bg-cat-blue-surface", text: "text-cat-blue" },
  Democratic: { bg: "bg-cat-blue-surface", text: "text-cat-blue" },
  Republican: { bg: "bg-cat-red-surface", text: "text-cat-red" },
  Independent: { bg: "bg-cat-purple-surface", text: "text-cat-purple" },
  Green: { bg: "bg-cat-green-surface", text: "text-cat-green" },
  Libertarian: { bg: "bg-cat-amber-surface", text: "text-cat-amber" },
};

export function PartyBadge({
  party,
  size = "sm",
}: {
  readonly party?: string;
  readonly size?: "sm" | "md";
}) {
  if (!party) return null;
  const colors = PARTY_COLORS[party] || {
    bg: "bg-surface-alt",
    text: "text-content",
  };
  const sizeClass =
    size === "md"
      ? "px-3 py-1 rounded-full text-sm"
      : "px-2.5 py-0.5 rounded-full text-xs";
  return (
    <span
      className={`inline-flex items-center font-medium ${sizeClass} ${colors.bg} ${colors.text}`}
    >
      {party}
    </span>
  );
}

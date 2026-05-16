const PARTY_COLORS: Record<string, { bg: string; text: string }> = {
  Democrat: { bg: "bg-blue-100", text: "text-blue-800" },
  Democratic: { bg: "bg-blue-100", text: "text-blue-800" },
  Republican: { bg: "bg-red-100", text: "text-red-800" },
  Independent: { bg: "bg-purple-100", text: "text-purple-800" },
  Green: { bg: "bg-green-100", text: "text-green-800" },
  Libertarian: { bg: "bg-yellow-100", text: "text-yellow-800" },
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
    bg: "bg-gray-100",
    text: "text-gray-800",
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

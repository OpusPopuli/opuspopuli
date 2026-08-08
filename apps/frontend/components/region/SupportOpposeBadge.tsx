export function SupportOpposeBadge({
  value,
}: {
  readonly value: string | null | undefined;
}) {
  if (!value) return null;
  const isSupport = value === "support";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isSupport
          ? "bg-positive-surface text-positive"
          : "bg-danger-surface text-danger"
      }`}
    >
      {value}
    </span>
  );
}

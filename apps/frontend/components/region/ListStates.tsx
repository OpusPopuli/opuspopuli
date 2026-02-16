export function LoadingSkeleton({
  count = 3,
  height = "h-32",
  grid = false,
}: {
  readonly count?: number;
  readonly height?: string;
  readonly grid?: boolean;
}) {
  return (
    <div
      className={grid ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4"}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className={`bg-gray-200 rounded-xl ${height}`}></div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ entity }: { readonly entity: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-red-600">
        Failed to load {entity}. Please try again later.
      </p>
    </div>
  );
}

export function EmptyState({ entity }: { readonly entity: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
      <p className="text-[#555555]">No {entity} found.</p>
    </div>
  );
}

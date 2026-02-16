export function Pagination({
  page,
  pageSize,
  total,
  hasMore,
  onPageChange,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <p className="text-sm text-[#555555]">
        Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, total)}{" "}
        of {total}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!hasMore}
          className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      {/* Header */}
      <header className="p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-10 h-10 bg-[#1e293b] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">Q</span>
          </div>
          <span className="text-[#1e293b] font-semibold text-lg">
            Opus Populi
          </span>
        </Link>
      </header>

      {/* Main Content - Centered */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-sm text-[#64748b]">
          Powered by{" "}
          <a
            href="https://murmur.network"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1e293b] font-medium hover:underline"
          >
            Murmur Network
          </a>
        </p>
      </footer>
    </div>
  );
}

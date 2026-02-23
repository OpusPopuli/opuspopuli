import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col">
      {/* Header */}
      <header className="p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-10 h-10 bg-[#222222] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">Q</span>
          </div>
          <span className="text-[#222222] font-semibold text-lg">
            Opus Populi
          </span>
        </Link>
      </header>

      {/* Main Content - Centered */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center space-y-2">
        <p className="text-sm text-[#555555]">
          Powered by{" "}
          <a
            href="https://opuspopuli.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#222222] font-medium hover:underline"
          >
            Opus Populi
          </a>
        </p>
        <p className="text-xs text-[#888888]">
          <Link href="/privacy" className="hover:underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" className="hover:underline">
            Terms of Service
          </Link>
        </p>
      </footer>
    </div>
  );
}

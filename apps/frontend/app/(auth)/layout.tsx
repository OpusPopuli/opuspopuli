import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";

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
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <img
            src="/logos/svg/op-horizontal-light.svg"
            alt="Opus Populi"
            className="h-8"
          />
        </Link>
      </header>

      {/* Main Content - Centered */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <Footer />
    </div>
  );
}

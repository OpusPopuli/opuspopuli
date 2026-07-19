import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="max-w-6xl mx-auto px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-content-dim">
          &copy; {new Date().getFullYear()} Opus Populi. All rights reserved.
        </p>
        <nav className="flex items-center gap-6">
          <Link
            href="/privacy"
            className="text-sm text-content-dim hover:text-content"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-content-dim hover:text-content"
          >
            Terms of Service
          </Link>
          <Link
            href="/our-commitments"
            className="text-sm text-content-dim hover:text-content"
          >
            Our Commitments
          </Link>
          <Link
            href="/transparency"
            className="text-sm text-content-dim hover:text-content"
          >
            Transparency
          </Link>
        </nav>
      </div>
    </footer>
  );
}

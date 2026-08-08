import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      {/* Illustrative-purpose notice (#962): the platform is a civic-education
          tool built on public sources; summaries and data matches are
          automated and may be inaccurate. Site-wide safety net against
          misreading derived views (esp. campaign-finance attributions) as
          authoritative or as allegations. */}
      <div className="max-w-6xl mx-auto px-8 pt-6">
        <p className="text-sm leading-relaxed text-content-dim">
          Opus Populi is a civic-education tool for illustrative purposes. Its
          data comes from official public records (such as the California
          Secretary of State&apos;s CAL-ACCESS database and the U.S. Federal
          Election Commission), always with attribution. Those records are
          authoritative; the summaries this site generates are AI-produced, and
          the links it draws (including campaign-finance attributions) are
          automated best-effort and may be incomplete or inaccurate — not an
          allegation of wrongdoing. Verify against the official sources before
          relying on or republishing anything here.
        </p>
      </div>
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

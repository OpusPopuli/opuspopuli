import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Terms of Service | Opus Populi",
  description:
    "Terms and conditions governing your use of the Opus Populi civic engagement platform.",
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: March 2026
        </p>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          {/* Introduction */}
          <section>
            <p>
              Welcome to Opus Populi. By accessing or using our platform, you
              agree to be bound by these Terms of Service (&quot;Terms&quot;).
              Please read them carefully before using the platform.
            </p>
          </section>

          {/* 1. Acceptance of Terms */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By creating an account or using Opus Populi, you agree to these
              Terms and our{" "}
              <Link
                href="/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Privacy Policy
              </Link>
              . If you do not agree, you may not use the platform. We may update
              these Terms from time to time, and continued use constitutes
              acceptance of the revised Terms.
            </p>
          </section>

          {/* 2. Eligibility */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              2. Eligibility
            </h2>
            <p>
              You must be at least 13 years of age to use Opus Populi. By using
              the platform, you represent that you meet this requirement. If you
              are under 18, you should review these Terms with a parent or
              guardian.
            </p>
          </section>

          {/* 3. Account Responsibilities */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              3. Account Responsibilities
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                You are responsible for maintaining the security of your account
                credentials, including passkeys and passwords.
              </li>
              <li>
                You agree to provide accurate information when creating your
                account and to keep it up to date.
              </li>
              <li>
                You are responsible for all activity that occurs under your
                account.
              </li>
              <li>
                Notify us immediately if you suspect unauthorized access to your
                account.
              </li>
            </ul>
          </section>

          {/* 4. Acceptable Use */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              4. Acceptable Use
            </h2>
            <p className="mb-3">
              You agree to use Opus Populi for lawful civic engagement purposes.
              You may not:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Use the platform to spread misinformation, harassment, or hate
                speech.
              </li>
              <li>
                Attempt to interfere with, disrupt, or compromise the
                platform&apos;s infrastructure or security.
              </li>
              <li>
                Scrape, harvest, or collect data from the platform through
                automated means without authorization.
              </li>
              <li>
                Impersonate other users, representatives, or government
                officials.
              </li>
              <li>
                Use the platform for commercial solicitation or advertising
                without prior written consent.
              </li>
            </ul>
          </section>

          {/* 5. Civic Data & AI Analysis */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              5. Civic Data &amp; AI Analysis
            </h2>
            <p className="mb-3">
              Opus Populi provides civic information including ballot measures,
              representative data, campaign finance records, and petition
              analysis. You acknowledge that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                AI-generated summaries and analyses are provided for
                informational purposes only and should not be relied upon as
                legal, financial, or political advice.
              </li>
              <li>
                While we strive for accuracy, civic data may contain errors or
                become outdated. Always verify important information through
                official government sources.
              </li>
              <li>
                Our AI transparency commitments are detailed on our{" "}
                <Link
                  href="/transparency"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Transparency
                </Link>{" "}
                page.
              </li>
            </ul>
          </section>

          {/* 6. Intellectual Property */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              6. Intellectual Property
            </h2>
            <p className="mb-3">
              Opus Populi is an open-source project. The platform&apos;s source
              code is available under its respective open-source license.
              However:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                The Opus Populi name, logo, and branding are our trademarks and
                may not be used without permission.
              </li>
              <li>
                Content you submit (e.g., petition scans, comments) remains
                yours, but you grant us a license to process and display it as
                part of the platform&apos;s functionality.
              </li>
              <li>
                Public civic data sourced from government agencies is not owned
                by Opus Populi and may be subject to its own terms.
              </li>
            </ul>
          </section>

          {/* 7. Limitation of Liability */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              7. Limitation of Liability
            </h2>
            <p className="mb-3">
              Opus Populi is provided &quot;as is&quot; and &quot;as
              available&quot; without warranties of any kind, express or
              implied. To the fullest extent permitted by law:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                We are not liable for any indirect, incidental, special, or
                consequential damages arising from your use of the platform.
              </li>
              <li>
                We do not guarantee uninterrupted or error-free access to the
                platform.
              </li>
              <li>
                Our total liability for any claim shall not exceed the amount
                you paid us in the 12 months preceding the claim (if any).
              </li>
            </ul>
          </section>

          {/* 8. Termination */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              8. Termination
            </h2>
            <p>
              You may delete your account at any time through your{" "}
              <Link
                href="/settings/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                privacy settings
              </Link>
              . We may suspend or terminate your account if you violate these
              Terms. Upon termination, your data will be handled in accordance
              with our{" "}
              <Link
                href="/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          {/* 9. Governing Law */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              9. Governing Law
            </h2>
            <p>
              These Terms are governed by the laws of the State of California,
              without regard to conflict of law principles. Any disputes arising
              from these Terms shall be resolved in the courts of California.
            </p>
          </section>

          {/* 10. Contact */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              10. Contact Information
            </h2>
            <p>
              If you have questions about these Terms of Service, please contact
              us at{" "}
              <a
                href="mailto:legal@opuspopuli.org"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                legal@opuspopuli.org
              </a>
              {"."}
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

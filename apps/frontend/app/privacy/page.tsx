import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy | Opus Populi",
  description:
    "Learn how Opus Populi collects, uses, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: February 2026
        </p>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          {/* Introduction */}
          <section>
            <p>
              Opus Populi (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;)
              is an open-source civic engagement platform. We are committed to
              protecting your privacy and being transparent about how we handle
              your data. This policy explains what information we collect, how
              we use it, and your rights regarding your data.
            </p>
          </section>

          {/* 1. Information We Collect */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              1. Information We Collect
            </h2>
            <p className="mb-3">
              We collect information that you provide directly and information
              generated through your use of the platform:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account information:</strong> Email address, name, and
                authentication credentials (passkey or password).
              </li>
              <li>
                <strong>Profile information:</strong> Optional details such as
                display name, photo, timezone, political affiliation, voting
                frequency, and policy priorities.
              </li>
              <li>
                <strong>Address information:</strong> Residential or mailing
                addresses used to determine your electoral districts and
                representatives.
              </li>
              <li>
                <strong>Civic engagement data:</strong> Your interactions with
                ballot measures, representatives, and legislative content.
              </li>
              <li>
                <strong>Usage data:</strong> Session information (device type,
                browser), consent records, and notification preferences.
              </li>
            </ul>
          </section>

          {/* 2. How We Use Your Information */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              2. How We Use Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Provide personalized civic information based on your location
                and interests.
              </li>
              <li>
                Match you with your elected representatives and relevant ballot
                measures.
              </li>
              <li>
                Send notifications about elections, voter deadlines, and
                legislative updates (with your consent).
              </li>
              <li>
                Improve the platform through anonymized, aggregated usage
                analytics.
              </li>
              <li>Ensure account security and prevent abuse.</li>
            </ul>
          </section>

          {/* 3. Data Retention */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              3. Data Retention
            </h2>
            <p className="mb-3">
              We retain your data for as long as your account is active. When
              you delete your account:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Personal data (profile, addresses, preferences) is deleted
                within 30 days.
              </li>
              <li>
                Consent records and audit logs are retained for up to 3 years
                for legal compliance.
              </li>
              <li>
                Anonymized, aggregated data may be retained indefinitely for
                platform improvement.
              </li>
            </ul>
          </section>

          {/* 4. Your Rights */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              4. Your Rights
            </h2>
            <p className="mb-3">
              You have the following rights regarding your personal data:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Access:</strong> Request a copy of all data we hold
                about you. Use the{" "}
                <Link
                  href="/settings/privacy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  data export
                </Link>{" "}
                feature in your settings.
              </li>
              <li>
                <strong>Deletion:</strong> Request deletion of your account and
                associated data.
              </li>
              <li>
                <strong>Correction:</strong> Update or correct your personal
                information at any time through your profile settings.
              </li>
              <li>
                <strong>Opt-out:</strong> Withdraw consent for optional data
                processing (marketing, analytics, personalization) through your{" "}
                <Link
                  href="/settings/privacy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  privacy settings
                </Link>
                .
              </li>
              <li>
                <strong>Portability:</strong> Export your data in a
                machine-readable JSON format.
              </li>
            </ul>
            <p className="mt-3">
              These rights apply under the California Consumer Privacy Act
              (CCPA) and similar state privacy laws. We do not discriminate
              against users who exercise their privacy rights.
            </p>
          </section>

          {/* 5. Security */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              5. Security Measures
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                All connections are encrypted via TLS (HTTPS) through
                Cloudflare&apos;s edge network.
              </li>
              <li>
                Passwords are hashed using industry-standard algorithms;
                passkeys use WebAuthn for phishing-resistant authentication.
              </li>
              <li>
                Database access is restricted and monitored with audit logging.
              </li>
              <li>
                We follow the principle of least privilege for all system
                access.
              </li>
            </ul>
          </section>

          {/* 6. Third-Party Services */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              6. Third-Party Services
            </h2>
            <p className="mb-3">
              We use the following third-party services to operate the platform:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Cloudflare:</strong> CDN, DNS, and edge networking.
                Subject to{" "}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Cloudflare&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Supabase:</strong> Database and authentication
                infrastructure. Subject to{" "}
                <a
                  href="https://supabase.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Supabase&apos;s Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>AI/LLM Processing:</strong> We use locally-hosted AI
                models for content analysis. Your data is not sent to external
                AI providers.
              </li>
            </ul>
            <p className="mt-3 font-medium">
              We do not sell your personal data to third parties.
            </p>
          </section>

          {/* 7. Children's Privacy */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              7. Children&apos;s Privacy
            </h2>
            <p>
              Opus Populi is intended for users aged 13 and older. We do not
              knowingly collect personal information from children under 13. If
              you believe a child has provided us with personal data, please
              contact us and we will promptly delete it.
            </p>
          </section>

          {/* 8. Changes to This Policy */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              8. Changes to This Policy
            </h2>
            <p>
              We may update this privacy policy from time to time. Material
              changes will be communicated through the platform or via email.
              The &quot;Last updated&quot; date at the top of this page reflects
              the most recent revision.
            </p>
          </section>

          {/* 9. Contact */}
          <section>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
              9. Contact Information
            </h2>
            <p>
              If you have questions about this privacy policy or wish to
              exercise your data rights, please contact us at{" "}
              <a
                href="mailto:privacy@opuspopuli.org"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                privacy@opuspopuli.org
              </a>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

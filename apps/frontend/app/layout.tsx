import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme-context";
import { ApolloProvider } from "@/lib/apollo-provider";
import { ToastProvider } from "@/lib/toast";
import { OnboardingProvider } from "@/lib/onboarding-context";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ScanFab } from "@/components/ScanFab";
import { JsonLd } from "@/components/JsonLd";

/*
 * Fonts are served from this repo, NOT fetched from Google at build time.
 *
 * `next/font/google` downloads the woff2 files during every build. That makes
 * fonts.gstatic.com a hard dependency of both CI and production deploys, and
 * it is not hypothetical: a build failed with "Failed to fetch font file from
 * https://fonts.gstatic.com/..." and took the whole pipeline with it. Nothing
 * about our code had changed. A deploy that can be broken by someone else's
 * CDN is a deploy we do not control.
 *
 * Variable fonts, so this is three files rather than the thirteen static
 * weights the previous configuration implied — ~126 KB total. The `weight`
 * ranges below must cover every weight used in the design, since a variable
 * font clamps to its declared range rather than failing loudly.
 *
 * Both faces are SIL Open Font License, which permits redistribution and
 * embedding. OFL is not a GPL-family licence, so this does not touch the
 * AGPL-3.0 constraint in CLAUDE.md.
 *
 * The CSS variable names are load-bearing: globals.css resolves the type
 * scale through them. Renaming either one silently falls back to system fonts.
 */
const inter = localFont({
  src: "./fonts/inter-variable.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const playfairDisplay = localFont({
  src: [
    {
      path: "./fonts/playfair-display-variable.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-variable-italic.woff2",
      weight: "400 700",
      style: "italic",
    },
  ],
  variable: "--font-playfair-display",
  display: "swap",
});

// Sets the .dark class before first paint to avoid a theme flash (FOUC).
const noFlashScript = `(function(){try{var t=localStorage.getItem('op-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');}catch(e){}})();`;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3200";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OPUS - Civic Engagement Platform | Opus Populi",
    template: "%s | Opus Populi",
  },
  description:
    "Empowering citizens with transparent access to propositions, representatives, campaign finance, and public meetings.",
  manifest: "/api/manifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OPUS",
  },
  keywords: [
    "civic engagement",
    "government transparency",
    "propositions",
    "campaign finance",
    "public meetings",
    "representatives",
    "Opus Populi",
  ],
  authors: [{ name: "Opus Populi", url: siteUrl }],
  creator: "Opus Populi",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Opus Populi",
    title: "OPUS - Civic Engagement Platform",
    description:
      "Empowering citizens with transparent access to civic data including propositions, representatives, campaign finance, and public meetings.",
    images: [
      {
        url: "/social/og-image.png",
        width: 1200,
        height: 630,
        alt: "Opus Populi - Civic Engagement Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OPUS - Civic Engagement Platform",
    description: "Empowering citizens with transparent access to civic data.",
    images: ["/social/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/opus-192.svg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1714" },
  ],
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Opus Populi",
  url: siteUrl,
  // Ink artwork — search engines composite this onto white, where the paper
  // ("light") variant would be invisible. Matches opuspopuli.org's choice.
  logo: `${siteUrl}/logos/png/op-horizontal-dark.png`,
  description: "Empowering citizens with transparent access to civic data.",
};

const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "OPUS",
  url: siteUrl,
  applicationCategory: "GovernmentApplication",
  operatingSystem: "Web",
  description:
    "Civic engagement platform providing transparent access to propositions, representatives, campaign finance, and public meetings.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The next/font variables MUST live on <html>: globals.css resolves
  // --font-inter in the `html` rule, and an out-of-scope var() there is
  // invalid-at-computed-value-time, which silently drops the whole app to the
  // browser's default serif.
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfairDisplay.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        <JsonLd data={organizationJsonLd} />
        <JsonLd data={webApplicationJsonLd} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <ApolloProvider>
            <ToastProvider>
              <OnboardingProvider>
                {children}
                {/* Inside OnboardingProvider so the FAB can hide itself during
                    the onboarding flow — its fixed bottom-right position
                    otherwise intercepts clicks on onboarding controls. */}
                <ScanFab />
              </OnboardingProvider>
              <OfflineIndicator />
            </ToastProvider>
          </ApolloProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

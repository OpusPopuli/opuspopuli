import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ApolloProvider } from "@/lib/apollo-provider";
import { ToastProvider } from "@/lib/toast";
import { OnboardingProvider } from "@/lib/onboarding-context";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { JsonLd } from "@/components/JsonLd";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

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
  themeColor: "#6f42c1",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Opus Populi",
  url: siteUrl,
  logo: `${siteUrl}/logos/png/op-mark-light.png`,
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
  return (
    <html lang="en">
      <head>
        <JsonLd data={organizationJsonLd} />
        <JsonLd data={webApplicationJsonLd} />
      </head>
      <body
        className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <ApolloProvider>
          <ToastProvider>
            <OnboardingProvider>{children}</OnboardingProvider>
            <OfflineIndicator />
          </ToastProvider>
        </ApolloProvider>
      </body>
    </html>
  );
}

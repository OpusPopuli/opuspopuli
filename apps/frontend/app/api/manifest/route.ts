import { NextRequest, NextResponse } from "next/server";

interface ProductConfig {
  name: string;
  short_name: string;
  description: string;
  theme_color: string;
  background_color?: string;
  start_url: string;
  id: string;
}

const products: Record<string, ProductConfig> = {
  default: {
    name: "OPUS",
    short_name: "OPUS",
    description: "Civic engagement platform by Commonwealth Labs",
    theme_color: "#6f42c1",
    background_color: "#ffffff",
    start_url: "/",
    id: "opus",
  },
  petition: {
    name: "OPUS Petition",
    short_name: "Petition",
    description: "Petition scanning and verification",
    theme_color: "#6f42c1",
    background_color: "#ffffff",
    start_url: "/petition",
    id: "opus-petition",
  },
  ballot: {
    name: "OPUS Ballot",
    short_name: "Ballot",
    description: "Voter information and ballot tracking",
    theme_color: "#1d76db",
    background_color: "#ffffff",
    start_url: "/ballot",
    id: "opus-ballot",
  },
  record: {
    name: "OPUS Record",
    short_name: "Record",
    description: "Public records and transparency",
    theme_color: "#0e8a16",
    background_color: "#ffffff",
    start_url: "/record",
    id: "opus-record",
  },
  code: {
    name: "OPUS Code",
    short_name: "Code",
    description: "Municipal code and regulations",
    theme_color: "#d93f0b",
    background_color: "#ffffff",
    start_url: "/code",
    id: "opus-code",
  },
};

export async function GET(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  const product =
    Object.keys(products).find(
      (p) => p !== "default" && referer.includes(`/${p}`),
    ) || "default";

  const config = { ...products.default, ...products[product] };

  // Use 'opus' for default icons, otherwise use product name
  const iconPrefix = product === "default" ? "opus" : product;

  const manifest = {
    ...config,
    display: "standalone",
    orientation: product === "petition" ? "portrait" : "any",
    icons: [
      {
        src: `/icons/${iconPrefix}-192.svg`,
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
      {
        src: `/icons/${iconPrefix}-512.svg`,
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
    shortcuts:
      product === "default"
        ? [
            {
              name: "Petition",
              url: "/petition",
              icons: [
                {
                  src: "/icons/petition-96.svg",
                  sizes: "96x96",
                  type: "image/svg+xml",
                },
              ],
            },
            {
              name: "Ballot",
              url: "/ballot",
              icons: [
                {
                  src: "/icons/ballot-96.svg",
                  sizes: "96x96",
                  type: "image/svg+xml",
                },
              ],
            },
            {
              name: "Record",
              url: "/record",
              icons: [
                {
                  src: "/icons/record-96.svg",
                  sizes: "96x96",
                  type: "image/svg+xml",
                },
              ],
            },
            {
              name: "Code",
              url: "/code",
              icons: [
                {
                  src: "/icons/code-96.svg",
                  sizes: "96x96",
                  type: "image/svg+xml",
                },
              ],
            },
          ]
        : undefined,
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}

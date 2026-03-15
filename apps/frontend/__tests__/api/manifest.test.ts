/**
 * Manifest API Route Tests
 *
 * Tests for the dynamic PWA manifest generation endpoint.
 *
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/manifest/route";

describe("Manifest API", () => {
  describe("GET /api/manifest", () => {
    it("should return default manifest when no referer", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "application/manifest+json",
      );
      expect(manifest.name).toBe("OPUS");
      expect(manifest.short_name).toBe("OPUS");
      expect(manifest.id).toBe("opus");
      expect(manifest.start_url).toBe("/");
      expect(manifest.display).toBe("standalone");
      expect(manifest.theme_color).toBe("#5A7A6A");
    });

    it("should return petition manifest for petition referer", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/petition/scan",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Petition");
      expect(manifest.short_name).toBe("Petition");
      expect(manifest.id).toBe("opus-petition");
      expect(manifest.start_url).toBe("/petition");
      expect(manifest.orientation).toBe("portrait");
    });

    it("should return ballot manifest for ballot referer", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/ballot/info",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Ballot");
      expect(manifest.short_name).toBe("Ballot");
      expect(manifest.id).toBe("opus-ballot");
      expect(manifest.start_url).toBe("/ballot");
      expect(manifest.theme_color).toBe("#1d76db");
    });

    it("should return record manifest for record referer", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/record/search",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Record");
      expect(manifest.short_name).toBe("Record");
      expect(manifest.id).toBe("opus-record");
      expect(manifest.theme_color).toBe("#0e8a16");
    });

    it("should return code manifest for code referer", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/code/browse",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Code");
      expect(manifest.short_name).toBe("Code");
      expect(manifest.id).toBe("opus-code");
      expect(manifest.theme_color).toBe("#d93f0b");
    });

    it("should include icons with correct prefix for default", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.icons).toHaveLength(2);
      expect(manifest.icons[0].src).toBe("/icons/opus-192.svg");
      expect(manifest.icons[1].src).toBe("/icons/opus-512.svg");
      expect(manifest.icons[0].type).toBe("image/svg+xml");
      expect(manifest.icons[0].purpose).toBe("any maskable");
    });

    it("should include icons with product prefix for product pages", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/petition",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.icons[0].src).toBe("/icons/petition-192.svg");
      expect(manifest.icons[1].src).toBe("/icons/petition-512.svg");
    });

    it("should include shortcuts for default manifest", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.shortcuts).toHaveLength(4);
      expect(manifest.shortcuts[0].name).toBe("Petition");
      expect(manifest.shortcuts[0].url).toBe("/petition");
      expect(manifest.shortcuts[1].name).toBe("Ballot");
      expect(manifest.shortcuts[2].name).toBe("Record");
      expect(manifest.shortcuts[3].name).toBe("Code");
    });

    it("should not include shortcuts for product-specific manifests", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/ballot",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.shortcuts).toBeUndefined();
    });

    it("should set orientation to 'any' for non-petition products", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/record",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.orientation).toBe("any");
    });

    it("should set orientation to 'portrait' for petition", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
        headers: {
          referer: "https://example.com/petition",
        },
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.orientation).toBe("portrait");
    });

    it("should always include background_color", async () => {
      const request = new NextRequest("https://example.com/api/manifest", {
        method: "GET",
      });

      const response = await GET(request);
      const manifest = await response.json();

      expect(manifest.background_color).toBe("#ffffff");
    });
  });
});

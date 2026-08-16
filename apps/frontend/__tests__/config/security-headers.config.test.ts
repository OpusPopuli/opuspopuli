/**
 * Security Headers Configuration Tests
 *
 * Tests for Content Security Policy and other security headers.
 * @see https://github.com/OpusPopuli/opuspopuli/issues/193
 */

beforeAll(async () => {
  // Reset environment variables
  (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
  delete process.env.NEXT_PUBLIC_GRAPHQL_URL;
  delete process.env.CSP_REPORT_URI;
});

describe("Security Headers Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    jest.resetModules();
    process.env = { ...originalEnv };
    (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
    delete process.env.NEXT_PUBLIC_GRAPHQL_URL;
    delete process.env.CSP_REPORT_URI;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getSecurityHeaders", () => {
    it("should return an array of security headers", async () => {
      // Re-import to get fresh module
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();

      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBeGreaterThan(0);
    });

    it("should include Content-Security-Policy header", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader).toBeDefined();
      expect(cspHeader?.value).toContain("default-src 'self'");
    });

    it("should include X-Content-Type-Options header", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const header = headers.find(
        (h: { key: string }) => h.key === "X-Content-Type-Options",
      );

      expect(header).toBeDefined();
      expect(header?.value).toBe("nosniff");
    });

    it("should include X-Frame-Options header", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const header = headers.find(
        (h: { key: string }) => h.key === "X-Frame-Options",
      );

      expect(header).toBeDefined();
      expect(header?.value).toBe("DENY");
    });

    it("should include Referrer-Policy header", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const header = headers.find(
        (h: { key: string }) => h.key === "Referrer-Policy",
      );

      expect(header).toBeDefined();
      expect(header?.value).toBe("strict-origin-when-cross-origin");
    });

    it("should include Permissions-Policy header", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const header = headers.find(
        (h: { key: string }) => h.key === "Permissions-Policy",
      );

      expect(header).toBeDefined();
      // Camera enabled for petition scanning feature
      expect(header?.value).toContain("camera=(self)");
      expect(header?.value).toContain("microphone=()");
      expect(header?.value).toContain("geolocation=(self)");
    });
  });

  describe("CSP Directives", () => {
    it("should include default-src self", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("default-src 'self'");
    });

    it("should include script-src with self", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("script-src 'self'");
    });

    /*
     * These two previously asserted the OPPOSITE — that the CSP allowed
     * fonts.googleapis.com and fonts.gstatic.com. Fonts are self-hosted now
     * (app/fonts/, see app/layout.tsx), so those allowances were dead grants
     * to an origin we no longer talk to. Inverted rather than deleted: they
     * are what catches a future `next/font/google` import, which would
     * reintroduce a build-time dependency on someone else's CDN and fail
     * closed at runtime against this CSP.
     */
    it("should serve fonts from self, not Google's CDN", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("font-src 'self'");
      expect(cspHeader?.value).not.toContain("fonts.gstatic.com");
    });

    it("should not grant style-src to Google's font CSS origin", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("style-src 'self'");
      expect(cspHeader?.value).not.toContain("fonts.googleapis.com");
    });

    it("should include img-src with data: and https:", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("img-src");
      expect(cspHeader?.value).toContain("data:");
      expect(cspHeader?.value).toContain("https:");
    });

    it("should include frame-ancestors none", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("frame-ancestors 'none'");
    });

    it("should include base-uri self", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("base-uri 'self'");
    });

    it("should include form-action self", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("form-action 'self'");
    });

    it("should include object-src none", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("object-src 'none'");
    });

    it("should include upgrade-insecure-requests only for HTTPS sites", async () => {
      // Without HTTPS site URL, directive should NOT be present
      delete process.env.NEXT_PUBLIC_SITE_URL;
      jest.resetModules();
      let configModule =
        await import("../../config/security-headers.config.mjs");
      let headers = configModule.getSecurityHeaders();
      let cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );
      expect(cspHeader?.value).not.toContain("upgrade-insecure-requests");

      // With HTTPS site URL, directive SHOULD be present
      process.env.NEXT_PUBLIC_SITE_URL = "https://opuspopuli.org";
      jest.resetModules();
      configModule = await import("../../config/security-headers.config.mjs");
      headers = configModule.getSecurityHeaders();
      cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );
      expect(cspHeader?.value).toContain("upgrade-insecure-requests");
    });
  });

  describe("API URL Configuration", () => {
    it("should include API origin in connect-src when NEXT_PUBLIC_GRAPHQL_URL is set", async () => {
      process.env.NEXT_PUBLIC_GRAPHQL_URL = "https://api.example.com/graphql";

      // Re-import to pick up new env var
      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("connect-src");
      expect(cspHeader?.value).toContain("https://api.example.com");
    });

    it("should include WebSocket origin when API URL is set", async () => {
      process.env.NEXT_PUBLIC_GRAPHQL_URL = "https://api.example.com/graphql";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("wss://api.example.com");
    });

    it("should handle invalid API URL gracefully", async () => {
      process.env.NEXT_PUBLIC_GRAPHQL_URL = "not-a-valid-url";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();

      // Should not throw and should return valid headers
      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBeGreaterThan(0);
    });
  });

  describe("CSP Report URI Configuration", () => {
    it("should include report-uri when CSP_REPORT_URI is set", async () => {
      process.env.CSP_REPORT_URI = "https://report.example.com/csp";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain(
        "report-uri https://report.example.com/csp",
      );
    });

    it("should include Report-To header when CSP_REPORT_URI is set", async () => {
      process.env.CSP_REPORT_URI = "https://report.example.com/csp";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const reportToHeader = headers.find(
        (h: { key: string }) => h.key === "Report-To",
      );

      expect(reportToHeader).toBeDefined();
      expect(reportToHeader?.value).toContain("csp-endpoint");
    });

    it("should not include report-uri when CSP_REPORT_URI is not set", async () => {
      delete process.env.CSP_REPORT_URI;

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).not.toContain("report-uri");
    });
  });

  describe("Production Mode", () => {
    it("should include HSTS header in production", async () => {
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const hstsHeader = headers.find(
        (h: { key: string }) => h.key === "Strict-Transport-Security",
      );

      expect(hstsHeader).toBeDefined();
      expect(hstsHeader?.value).toContain("max-age=31536000");
      expect(hstsHeader?.value).toContain("includeSubDomains");
      expect(hstsHeader?.value).toContain("preload");
    });

    it("should not include HSTS header in development", async () => {
      (process.env as { NODE_ENV?: string }).NODE_ENV = "development";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const hstsHeader = headers.find(
        (h: { key: string }) => h.key === "Strict-Transport-Security",
      );

      expect(hstsHeader).toBeUndefined();
    });

    it("should not include unsafe-eval in production", async () => {
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      // In production, we should not have unsafe-eval
      // Note: This test may need adjustment based on actual Next.js requirements
      const scriptSrcMatch = cspHeader?.value.match(/script-src[^;]*/);
      expect(scriptSrcMatch?.[0]).not.toContain("'unsafe-eval'");
    });

    it("should include unsafe-eval in development for HMR", async () => {
      (process.env as { NODE_ENV?: string }).NODE_ENV = "development";

      jest.resetModules();
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("'unsafe-eval'");
    });
  });
});

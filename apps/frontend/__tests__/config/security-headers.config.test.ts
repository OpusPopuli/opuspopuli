/**
 * Security Headers Configuration Tests
 *
 * Tests for Content Security Policy and other security headers.
 * @see https://github.com/OpusPopuli/opuspopuli/issues/193
 */

// We need to dynamically import the ESM module
let getSecurityHeaders: () => Array<{ key: string; value: string }>;
let testingExports: {
  buildCspDirectives: () => string;
  buildReportToHeader: () => string | null;
  getApiUrl: () => string | null;
  isProduction: boolean;
};

beforeAll(async () => {
  // Reset environment variables
  (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
  delete process.env.NEXT_PUBLIC_GRAPHQL_URL;
  delete process.env.CSP_REPORT_URI;

  // Dynamic import for ESM module
  const configModule = await import("../../config/security-headers.config.mjs");
  getSecurityHeaders = configModule.getSecurityHeaders;
  testingExports = configModule.__testing__;
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

    it("should include style-src with fonts.googleapis.com", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("style-src");
      expect(cspHeader?.value).toContain("https://fonts.googleapis.com");
    });

    it("should include font-src with fonts.gstatic.com", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
        (h: { key: string }) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("font-src");
      expect(cspHeader?.value).toContain("https://fonts.gstatic.com");
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

    it("should include upgrade-insecure-requests", async () => {
      const configModule =
        await import("../../config/security-headers.config.mjs");
      const headers = configModule.getSecurityHeaders();
      const cspHeader = headers.find(
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

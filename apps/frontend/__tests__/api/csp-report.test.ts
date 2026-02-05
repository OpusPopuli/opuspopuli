/**
 * CSP Report API Route Tests
 *
 * Tests for the Content Security Policy violation reporting endpoint.
 * @see https://github.com/OpusPopuli/opuspopuli/issues/193
 *
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { POST, OPTIONS } from "@/app/api/csp-report/route";

// Mock console methods
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe("CSP Report API", () => {
  describe("POST /api/csp-report", () => {
    it("should accept valid CSP violation report", async () => {
      const report = {
        "csp-report": {
          "document-uri": "https://example.com/page",
          "violated-directive": "script-src",
          "effective-directive": "script-src",
          "blocked-uri": "https://evil.com/script.js",
          "source-file": "https://example.com/page",
          "line-number": 10,
          "column-number": 5,
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/csp-report",
        },
        body: JSON.stringify(report),
      });

      const response = await POST(request);

      expect(response.status).toBe(204);
      expect(console.warn).toHaveBeenCalled();
    });

    it("should accept report with application/json content type", async () => {
      const report = {
        "csp-report": {
          "document-uri": "https://example.com/page",
          "violated-directive": "style-src",
          "blocked-uri": "inline",
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
      });

      const response = await POST(request);

      expect(response.status).toBe(204);
    });

    it("should log violation details", async () => {
      const report = {
        "csp-report": {
          "document-uri": "https://example.com/page",
          "violated-directive": "script-src",
          "effective-directive": "script-src",
          "blocked-uri": "https://malicious.com/script.js",
          "source-file": "https://example.com/page",
          "line-number": 42,
          "column-number": 15,
          disposition: "enforce",
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/csp-report",
        },
        body: JSON.stringify(report),
      });

      await POST(request);

      expect(console.warn).toHaveBeenCalledWith(
        "[CSP Violation]",
        expect.stringContaining("script-src"),
      );
      expect(console.warn).toHaveBeenCalledWith(
        "[CSP Violation]",
        expect.stringContaining("https://malicious.com/script.js"),
      );
    });

    it("should return 400 for report without csp-report field", async () => {
      const report = {
        "invalid-field": {
          "document-uri": "https://example.com/page",
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/csp-report",
        },
        body: JSON.stringify(report),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid report structure");
    });

    it("should return 400 for invalid JSON", async () => {
      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "not valid json {{{",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid report format");
    });

    it("should handle reports with minimal fields", async () => {
      const report = {
        "csp-report": {
          "violated-directive": "default-src",
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/csp-report",
        },
        body: JSON.stringify(report),
      });

      const response = await POST(request);

      expect(response.status).toBe(204);
    });

    it("should handle non-standard content types gracefully", async () => {
      const report = {
        "csp-report": {
          "document-uri": "https://example.com/page",
          "violated-directive": "img-src",
        },
      };

      const request = new NextRequest("https://example.com/api/csp-report", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: JSON.stringify(report),
      });

      const response = await POST(request);

      expect(response.status).toBe(204);
    });
  });

  describe("OPTIONS /api/csp-report", () => {
    it("should return 204 for preflight request", async () => {
      const response = await OPTIONS();

      expect(response.status).toBe(204);
    });

    it("should include CORS headers", async () => {
      const response = await OPTIONS();

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS",
      );
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type",
      );
    });
  });
});

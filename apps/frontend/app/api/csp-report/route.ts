import { NextRequest, NextResponse } from "next/server";

/**
 * CSP Violation Report Interface
 *
 * Represents the structure of a CSP violation report sent by browsers.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
 */
interface CspViolationReport {
  "csp-report"?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "original-policy"?: string;
    "blocked-uri"?: string;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
    "status-code"?: number;
    disposition?: string;
    referrer?: string;
  };
}

/**
 * CSP Violation Reporting Endpoint
 *
 * Receives Content Security Policy violation reports from browsers.
 * These reports help identify CSP issues without breaking functionality.
 *
 * To enable CSP reporting:
 * 1. Set CSP_REPORT_URI environment variable to the full URL of this endpoint
 * 2. Example: CSP_REPORT_URI=https://app.opuspopuli.com/api/csp-report
 *
 * In development, violations are logged to console.
 * In production, you may want to forward these to a logging service.
 *
 * @see https://github.com/CommonwealthLabsCode/opuspopuli/issues/193
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the CSP report
    const contentType = request.headers.get("content-type") || "";

    let report: CspViolationReport;

    // CSP reports are sent as application/csp-report or application/json
    if (
      contentType.includes("application/csp-report") ||
      contentType.includes("application/json")
    ) {
      report = await request.json();
    } else {
      // Some browsers may send reports with different content types
      const text = await request.text();
      try {
        report = JSON.parse(text);
      } catch {
        console.warn("[CSP Report] Invalid report format received");
        return NextResponse.json(
          { error: "Invalid report format" },
          { status: 400 },
        );
      }
    }

    const cspReport = report["csp-report"];

    if (!cspReport) {
      console.warn("[CSP Report] Missing csp-report field in report");
      return NextResponse.json(
        { error: "Invalid report structure" },
        { status: 400 },
      );
    }

    // Log the violation
    // In production, you may want to send this to a logging service
    const logEntry = {
      timestamp: new Date().toISOString(),
      documentUri: cspReport["document-uri"],
      violatedDirective: cspReport["violated-directive"],
      effectiveDirective: cspReport["effective-directive"],
      blockedUri: cspReport["blocked-uri"],
      sourceFile: cspReport["source-file"],
      lineNumber: cspReport["line-number"],
      columnNumber: cspReport["column-number"],
      disposition: cspReport.disposition,
    };

    if (process.env.NODE_ENV === "development") {
      console.warn("[CSP Violation]", JSON.stringify(logEntry, null, 2));
    } else {
      // In production, log without pretty printing for structured logging
      console.warn("[CSP Violation]", JSON.stringify(logEntry));
    }

    // Return 204 No Content as recommended for report endpoints
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[CSP Report] Error processing report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

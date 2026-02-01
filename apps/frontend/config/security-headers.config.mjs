/**
 * Security Headers Configuration for Next.js
 *
 * Provides Content Security Policy (CSP) and other security headers
 * to protect against XSS, clickjacking, and other web vulnerabilities.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/193
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
 */

/**
 * Check if running in production mode
 */
const isProduction = process.env.NODE_ENV === "production";

/**
 * Get the API URL for connect-src directive
 * Falls back to same-origin in production
 */
function getApiUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL;
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      return url.origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get the CSP report URI if configured
 */
function getReportUri() {
  return process.env.CSP_REPORT_URI || null;
}

/**
 * Build Content Security Policy directives
 *
 * CSP restricts where resources can be loaded from, preventing XSS attacks
 * by blocking inline scripts and unauthorized external resources.
 */
function buildCspDirectives() {
  const apiOrigin = getApiUrl();
  const reportUri = getReportUri();

  // Base connect sources - always allow self
  const connectSources = ["'self'"];
  if (apiOrigin && apiOrigin !== "'self'") {
    connectSources.push(apiOrigin);
    // Also allow WebSocket connections to the API
    const wsOrigin = apiOrigin.replace(/^http/, "ws");
    connectSources.push(wsOrigin);
  }

  // Script sources
  // Note: Next.js requires 'unsafe-inline' for inline scripts in development
  // and 'unsafe-eval' for hot module replacement. In production, we use nonce-based
  // CSP which Next.js supports via the nonce prop, but for simplicity we allow
  // 'unsafe-inline' with strict-dynamic would be ideal but requires nonce support
  const scriptSources = ["'self'"];
  if (!isProduction) {
    // Development requires eval for HMR
    scriptSources.push("'unsafe-eval'");
  }
  // Allow inline scripts - Next.js injects inline scripts for hydration
  scriptSources.push("'unsafe-inline'");

  // Style sources
  // Next.js and many component libraries use inline styles
  const styleSources = [
    "'self'",
    "'unsafe-inline'", // Required for CSS-in-JS and inline styles
    "https://fonts.googleapis.com",
  ];

  // Font sources
  const fontSources = [
    "'self'",
    "https://fonts.gstatic.com",
    "data:", // For embedded fonts
  ];

  // Image sources
  // Allow data: for inline images and https: for external images
  const imgSources = [
    "'self'",
    "data:",
    "blob:",
    "https:", // Allow all HTTPS images
  ];

  // Frame ancestors - prevent clickjacking
  const frameAncestors = ["'none'"];

  // Build the CSP directives array
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    `font-src ${fontSources.join(" ")}`,
    `img-src ${imgSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `frame-ancestors ${frameAncestors.join(" ")}`,
    "worker-src 'self' blob:", // Service workers for PWA
    "manifest-src 'self'", // Web app manifest for PWA
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'", // Prevent plugins like Flash
    "upgrade-insecure-requests", // Upgrade HTTP to HTTPS
  ];

  // Add report-uri if configured
  if (reportUri) {
    directives.push(`report-uri ${reportUri}`);
    directives.push("report-to csp-endpoint");
  }

  return directives.join("; ");
}

/**
 * Build the Report-To header for CSP violation reporting
 */
function buildReportToHeader() {
  const reportUri = getReportUri();
  if (!reportUri) return null;

  return JSON.stringify({
    group: "csp-endpoint",
    max_age: 86400,
    endpoints: [{ url: reportUri }],
  });
}

/**
 * Get all security headers for Next.js
 *
 * These headers provide defense-in-depth against common web vulnerabilities.
 */
export function getSecurityHeaders() {
  const headers = [
    // Content Security Policy
    {
      key: "Content-Security-Policy",
      value: buildCspDirectives(),
    },
    // Prevent MIME type sniffing
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    // Prevent clickjacking (backup for CSP frame-ancestors)
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    // Control referrer information
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    // Permissions policy - enable camera for petition scanning
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(), geolocation=(self), interest-cohort=()",
    },
  ];

  // Add HSTS in production
  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains; preload",
    });
  }

  // Add Report-To header if CSP reporting is configured
  const reportTo = buildReportToHeader();
  if (reportTo) {
    headers.push({
      key: "Report-To",
      value: reportTo,
    });
  }

  return headers;
}

/**
 * Export individual functions for testing
 */
export const __testing__ = {
  buildCspDirectives,
  buildReportToHeader,
  getApiUrl,
  isProduction,
};

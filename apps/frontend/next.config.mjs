import withSerwistInit from "@serwist/next";
import { getSecurityHeaders } from "./config/security-headers.config.mjs";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: "standalone" output removed for Cloudflare Pages compatibility.
  // For Docker deployments, set NEXT_OUTPUT=standalone in the Dockerfile build args.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),

  // Empty turbopack config silences the webpack/turbopack warning
  // Serwist requires webpack for building the service worker (--webpack flag in build)
  // but dev server can use turbopack for faster HMR
  turbopack: {},

  /**
   * Security headers configuration
   *
   * Adds Content Security Policy and other security headers to all routes.
   * CSP helps prevent XSS attacks by restricting resource loading.
   *
   * @see https://github.com/OpusPopuli/opuspopuli/issues/193
   */
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/:path*",
        headers: getSecurityHeaders(),
      },
    ];
  },

  /**
   * Dev-only same-origin proxy to the backend API gateway.
   *
   * The gateway seeds its CSRF token via `Set-Cookie: csrf-token=…; SameSite=Strict`.
   * A Strict cookie is dropped by the browser on a cross-site response, so a browser
   * on http://localhost:3200 talking directly to the gateway (a different site) can
   * never complete the CSRF double-submit — every request 403s "CSRF token required".
   *
   * Proxying /api through the Next dev server makes the browser see a single origin
   * (localhost:3200), so the Strict cookie is first-party and CSRF/cookies/CORS all
   * work. Set NEXT_PUBLIC_GRAPHQL_URL=/api so Apollo targets this same-origin path.
   * Override the target with API_PROXY_TARGET (e.g. a Cloudflare Tunnel URL).
   *
   * Gated to development. `rewrites()` otherwise applies to production builds
   * too, and in prod the browser talks to the API directly at its own origin
   * (e.g. https://api.opuspopuli.org) — no same-origin proxy is needed there.
   */
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const target =
      process.env.API_PROXY_TARGET || "http://opuspopuli-us-ca:8080";
    return [
      { source: "/api", destination: `${target}/api` },
      { source: "/api/:path*", destination: `${target}/api/:path*` },
    ];
  },
};

export default withSerwist(nextConfig);

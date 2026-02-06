import withSerwistInit from "@serwist/next";
import { getSecurityHeaders } from "./config/security-headers.config.mjs";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

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
};

export default withSerwist(nextConfig);

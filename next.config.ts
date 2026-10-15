import type { NextConfig } from "next";

/**
 * Sent with every response. A full Content-Security-Policy would also need
 * per-request nonces for Next.js's inline scripts; these cover the cheap,
 * high-value protections without one.
 */
const securityHeaders = [
  // Never guess a type from content: uploads are served with the type they were checked to be
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing here is meant to be framed, which also rules out clickjacking
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // Other sites see only the origin, never document or chat IDs from the URL
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these; turn them off for everything it loads
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // pdf-parse runs pdf.js, which loads its worker from a separate file at
  // runtime. Bundling copies the main code into .next/ but not the worker
  // ("Setting up fake worker failed: Cannot find module ...pdf.worker.mjs"),
  // so load it with Node's require from node_modules instead.
  serverExternalPackages: ["pdf-parse"],
  // No need to advertise the framework (and its version) to every visitor
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

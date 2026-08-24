import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a minimal self-contained server bundle for the runtime Docker stage.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // The /api/v1/:path* rewrite below proxies every backend request
    // through this dev/runtime server, which by default only buffers the
    // first 10MB of a request body before silently truncating it - past
    // that, "Restore WikiHub Backup" (a single multipart upload, unlike
    // the Confluence importer's chunked one) sent a corrupt, truncated
    // body, and the backend connection died with "socket hang up",
    // surfacing to the user as a generic 500. Raised well above the
    // backend's default `max_import_size_mb` (1024MB, see
    // backend/app/core/config.py) so an out-of-the-box restore fits
    // comfortably; an admin who raises that setting far beyond this needs
    // to raise this ceiling too, or hit the same truncation again.
    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024, // 2GB
  },
  // The backend's headless-browser export visits /print via the Docker
  // service hostname ("http://frontend:3000/print?..."), not localhost. Next
  // dev's cross-origin guard blocks unrecognised hosts from dev-only
  // resources (HMR, RSC) by default, which silently stalls client hydration
  // for that request - the exported page's readiness signal then never
  // fires. Harmless outside `next dev`; ignored in production builds.
  allowedDevOrigins: ["frontend"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

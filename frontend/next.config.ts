import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a minimal self-contained server bundle for the runtime Docker stage.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
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

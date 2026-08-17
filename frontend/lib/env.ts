/**
 * Runtime configuration.
 *
 * Browser requests use the current origin so the app works behind a reverse
 * proxy or a tunnel (for example ngrok). Next.js rewrites `/api/v1/*` to the
 * backend, which also keeps the httpOnly session cookie on the UI origin.
 * React Server Components inside Docker reach the API over the compose
 * network via `API_INTERNAL_BASE_URL`.
 */

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const PUBLIC_API_BASE_URL = stripTrailingSlash(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
);

/** Base URL to use for a fetch issued from this execution context. */
export function apiBaseUrl(): string {
  if (typeof window === "undefined") {
    return stripTrailingSlash(
      process.env.API_INTERNAL_BASE_URL ?? PUBLIC_API_BASE_URL,
    );
  }
  return window.location.origin;
}

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "WikiHub";

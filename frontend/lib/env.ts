/**
 * Runtime configuration.
 *
 * The browser talks to the API through `NEXT_PUBLIC_API_BASE_URL`, while React
 * Server Components inside Docker reach it directly over the compose network via
 * `API_INTERNAL_BASE_URL`. Keeping both here means no component has to know
 * which side of the network it is running on.
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
  return PUBLIC_API_BASE_URL;
}

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "WikiHub";

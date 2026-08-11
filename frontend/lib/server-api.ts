import { cookies } from "next/headers";

import { api } from "@/lib/api-client";
import { ACCESS_COOKIE_NAME } from "@/lib/auth";

/**
 * Server-side API access for React Server Components.
 *
 * The access token lives in an httpOnly cookie, so an RSC cannot attach a
 * bearer header — it has to forward the incoming cookie explicitly. This was
 * previously reimplemented in every server fetcher; keeping one copy stops that
 * from drifting as more admin fetchers land.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(ACCESS_COOKIE_NAME)?.value;
  return token ? { Cookie: `${ACCESS_COOKIE_NAME}=${token}` } : {};
}

/** GET as the signed-in user, never cached. */
export async function serverGet<T>(path: string): Promise<T> {
  return api.get<T>(path, { cache: "no-store", headers: await authHeaders() });
}

/** Build a query string, dropping empty values. */
export function queryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

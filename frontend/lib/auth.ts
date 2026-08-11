/**
 * Server-side session helpers.
 *
 * The access token lives in an httpOnly cookie, so it is unreadable from
 * JavaScript. A React Server Component therefore cannot simply attach a bearer
 * header — it has to forward the incoming cookie to the API, which is what
 * `getCurrentUser` does.
 *
 * The backend remains the sole authority on whether a session is valid: this
 * module never inspects or trusts the token's contents.
 */

import { cookies } from "next/headers";

import { api, ApiError } from "@/lib/api-client";
import type { Me } from "@/types/api";

/** Must match `ACCESS_COOKIE_NAME` in backend/app/api/deps.py. */
export const ACCESS_COOKIE_NAME = "wikihub_access";

/**
 * Resolve the signed-in user, or `null` when there is no valid session.
 *
 * A missing/expired/revoked token all yield `null` rather than throwing, so
 * callers can treat "signed out" as an ordinary state.
 */
export async function getCurrentUser(): Promise<Me | null> {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    return await api.get<Me>("/api/v1/auth/me", {
      cache: "no-store",
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=${token}` },
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    // A backend outage must not masquerade as "signed out" — surface it.
    throw error;
  }
}

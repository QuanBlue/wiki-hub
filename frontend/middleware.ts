/**
 * Route guard: everything requires a session except the login page itself.
 *
 * This is a *cheap* check — it only asks whether a session cookie is present,
 * never whether it is valid. Verifying the token here would mean an API round
 * trip on every navigation, and it would duplicate authority that belongs to
 * the backend. A forged or expired cookie gets past this middleware and is then
 * rejected by the API, which is the layer that actually decides.
 *
 * The guard exists for UX (send signed-out visitors to the login form), not for
 * security. Never put an authorization decision here.
 */

import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE_NAME = "wikihub_access";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(ACCESS_COOKIE_NAME)?.value);
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!hasSession && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where the user was heading so login can return them there.
    const target = `${pathname}${search}`;
    if (target && target !== "/") {
      loginUrl.searchParams.set("next", target);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Already signed in: the login page has nothing to offer.
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Skip Next.js internals, the favicon and static assets. Without this the
   * middleware would run for every chunk request and redirect them to /login,
   * breaking the login page's own JavaScript.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

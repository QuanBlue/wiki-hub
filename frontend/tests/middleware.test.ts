import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { bypassesSessionGuard, isApiRequestPath, middleware } from "@/middleware";

describe("session middleware", () => {
  it("bypasses the session guard for API requests", () => {
    expect(isApiRequestPath("/api/v1/auth/login")).toBe(true);
    expect(isApiRequestPath("/api/v1/auth/me")).toBe(true);
  });

  it("does not treat page routes as API requests", () => {
    expect(isApiRequestPath("/login")).toBe(false);
    expect(isApiRequestPath("/spaces")).toBe(false);
  });

  it("bypasses static scripts and Next runtime endpoints", () => {
    expect(bypassesSessionGuard("/remove-extension-hydration-markers.js")).toBe(true);
    expect(bypassesSessionGuard("/preload-sidebar-preferences.js")).toBe(true);
    expect(bypassesSessionGuard("/_next/hmr")).toBe(true);
    expect(bypassesSessionGuard("/spaces")).toBe(false);
  });

  it("does not redirect an unauthenticated /print export render to /login", () => {
    // The headless-browser export visit carries no session cookie at all -
    // only a Bearer export token its own server-side fetch attaches. The
    // real gate is /api/v1/export-render/bundle; this is UX-only.
    const request = new NextRequest(
      "http://localhost/print?token=abc.def.ghi",
    );
    const response = middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets someone who cannot sign in reach the contact-an-administrator page", () => {
    // Its whole purpose is people with no working account, so it cannot sit
    // behind the sign-in redirect.
    const response = middleware(new NextRequest("http://localhost/contact-admin"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps the admin mail pages behind sign-in", () => {
    for (const path of ["/admin/mail", "/admin/inbox"]) {
      const response = middleware(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get("location")).toContain("/login");
    }
  });

  it("still redirects an unauthenticated request to a real page", () => {
    const request = new NextRequest("http://localhost/spaces");
    const response = middleware(request);
    expect(response.headers.get("location")).toContain("/login");
  });
});

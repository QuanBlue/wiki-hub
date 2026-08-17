import { describe, expect, it } from "vitest";

import { bypassesSessionGuard, isApiRequestPath } from "@/middleware";

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
});

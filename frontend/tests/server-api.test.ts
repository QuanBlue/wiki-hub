import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, apiGetMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  apiGetMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/api-client", () => ({ api: { get: apiGetMock } }));

import { authHeaders, queryString, serverGet } from "@/lib/server-api";
import { ACCESS_COOKIE_NAME } from "@/lib/auth";

describe("queryString", () => {
  it("returns an empty string when there is nothing to encode", () => {
    expect(queryString({})).toBe("");
    expect(queryString({ q: undefined, status: null })).toBe("");
    expect(queryString({ q: "" })).toBe("");
  });

  it("builds a leading-? query string from the given params", () => {
    expect(queryString({ q: "search term", limit: 10 })).toBe("?q=search+term&limit=10");
  });

  it("drops only undefined/null/empty values, keeping falsy numbers", () => {
    expect(queryString({ offset: 0, limit: undefined })).toBe("?offset=0");
  });
});

describe("authHeaders", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    apiGetMock.mockReset();
  });

  it("forwards the access cookie when one is present", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) => (name === ACCESS_COOKIE_NAME ? { value: "tok" } : undefined),
    });

    expect(await authHeaders()).toEqual({ Cookie: `${ACCESS_COOKIE_NAME}=tok` });
  });

  it("returns no headers when there is no session cookie", async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined });

    expect(await authHeaders()).toEqual({});
  });
});

describe("serverGet", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    apiGetMock.mockReset();
    cookiesMock.mockResolvedValue({
      get: (name: string) => (name === ACCESS_COOKIE_NAME ? { value: "tok" } : undefined),
    });
  });

  it("fetches with the forwarded cookie and no caching", async () => {
    apiGetMock.mockResolvedValue({ ok: true });

    const result = await serverGet("/api/v1/settings");

    expect(result).toEqual({ ok: true });
    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/settings", {
      cache: "no-store",
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=tok` },
    });
  });
});

/**
 * The small fallbacks in `lib/` and `hooks/` that ordinary use never reaches:
 * a blocked API, an archive with nothing in it, a runtime without a time zone
 * database, a browser without a canvas. Each is a path that must still behave.
 */
import { renderHook } from "@testing-library/react";
import { NextRequest } from "next/server";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHydrated } from "@/hooks/use-hydrated";
import { ApiError, apiFetch, describeApiError } from "@/lib/api-client";
import { detectArchiveFormat } from "@/lib/archive-format";
import { apiBaseUrl } from "@/lib/env";
import { getGroupUsage, listGroupMembers } from "@/lib/group-members";
import { isLocalFindActive, markLocalFindActive } from "@/lib/local-find-registry";
import { groupPermissionAssignments } from "@/lib/permissions";
import { createFaviconDataUrl, renderFaviconPngDataUrl } from "@/lib/theme-presets";
import { middleware } from "@/middleware";
import type { SpacePermissionAssignment } from "@/types/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useHydrated", () => {
  it("is false while rendering on the server and true once hydrated", () => {
    function Probe() {
      return <>{String(useHydrated())}</>;
    }
    expect(renderToString(<Probe />)).toBe("false");
    expect(renderHook(() => useHydrated()).result.current).toBe(true);
  });
});

describe("middleware", () => {
  it("lets static assets through without a session", () => {
    const response = middleware(new NextRequest("http://localhost/logo.svg"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("apiFetch", () => {
  it("sends a bearer token when one is given", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    await apiFetch("/api/v1/thing", { token: "abc" });

    const headers = fetchSpy.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer abc");
  });

  it("returns a plain-text body as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("pong", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    expect(await apiFetch<string>("/ping")).toBe("pong");
  });
});

describe("describeApiError", () => {
  it("prefers the first field message, naming the field unless it is the body", () => {
    const field = new ApiError(422, "validation_error", "Invalid.", {
      fields: [{ field: "name", message: "Name is required." }],
    });
    const body = new ApiError(422, "validation_error", "Invalid.", {
      fields: [{ field: "body", message: "Body is malformed." }],
    });

    expect(describeApiError(field, "x")).toBe("name: Name is required.");
    expect(describeApiError(body, "x")).toBe("Body is malformed.");
  });

  it("falls back to the error's own message, then to the fallback", () => {
    const noMessage = new ApiError(422, "validation_error", "Invalid.", {
      fields: [{ field: "name" }],
    });

    expect(describeApiError(noMessage, "x")).toBe("Invalid.");
    expect(describeApiError(new ApiError(500, "e", "Server error."), "x")).toBe("Server error.");
    expect(describeApiError(new Error("boom"), "Something failed.")).toBe("Something failed.");
  });
});

describe("detectArchiveFormat", () => {
  it("does not classify an archive with an empty directory", async () => {
    const eocd = new Uint8Array(22);
    new DataView(eocd.buffer).setUint32(0, 0x06054b50, true);
    expect(await detectArchiveFormat(new File([eocd], "empty.zip"))).toBe("unknown");
  });

  it("never throws on a file that cannot be read", async () => {
    const unreadable = {
      size: 1024,
      slice: () => {
        throw new Error("gone");
      },
    } as unknown as File;
    expect(await detectArchiveFormat(unreadable)).toBe("unknown");
  });
});

describe("apiBaseUrl", () => {
  it("uses this origin in the browser and the internal URL on the server", () => {
    expect(apiBaseUrl()).toBe(window.location.origin);

    vi.stubGlobal("window", undefined);
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend:8000/");
    try {
      expect(apiBaseUrl()).toBe("http://backend:8000");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("group membership fetchers", () => {
  it("ask for a group's members and usage", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await listGroupMembers("g 1");
    await getGroupUsage("g 1");

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/v1/groups/g%201/members");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/api/v1/groups/g%201/usage");
  });
});

describe("local find registry", () => {
  it("releases a registration only once", () => {
    const release = markLocalFindActive();
    const other = markLocalFindActive();
    release();
    release();
    expect(isLocalFindActive()).toBe(true);
    other();
    expect(isLocalFindActive()).toBe(false);
  });
});

describe("groupPermissionAssignments", () => {
  it("folds one row per stored permission into one row per principal", () => {
    const row = (
      principal_id: string,
      principal_type: "user" | "group",
      permission: string,
    ) =>
      ({ principal_id, principal_type, permissions: [permission] }) as SpacePermissionAssignment;

    const grouped = groupPermissionAssignments([
      row("u1", "user", "view"),
      row("u1", "user", "add"),
      row("u1", "group", "view"),
      row("u1", "user", "view"),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].permissions).toEqual(["view", "add"]);
    expect(grouped[1].principal_type).toBe("group");
  });
});

describe("time zones", () => {
  afterEach(() => vi.resetModules());

  it("lists nothing in a runtime without the time zone database", async () => {
    vi.resetModules();
    vi.spyOn(Intl, "supportedValuesOf").mockImplementation(() => {
      throw new RangeError("unsupported");
    });

    const { TIMEZONE_IDS } = await import("@/lib/timezones");

    expect(TIMEZONE_IDS).toEqual([]);
  });

  it("labels a zone the formatter rejects with no offset", async () => {
    vi.resetModules();
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Not/AZone"]);

    const { timezoneOffsetLabel } = await import("@/lib/timezones");

    expect(timezoneOffsetLabel("Not/AZone")).toBe("");
  });
});

describe("favicons", () => {
  /** An <img> that loads (or fails) as soon as its src is set. */
  function stubImage(outcome: "load" | "error") {
    class FakeImage {
      width = 128;
      height = 64;
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => (outcome === "load" ? this.onload?.() : this.onerror?.()));
      }
    }
    vi.stubGlobal("Image", FakeImage);
  }

  it("draws the image onto a 64px canvas", async () => {
    stubImage("load");
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;x");

    expect(await createFaviconDataUrl("logo.png")).toBe("data:image/png;x");
    // Letterboxed: the wide image is scaled to fit and centred vertically.
    expect(drawImage.mock.calls[0].slice(5)).toEqual([0, 16, 64, 32]);
  });

  it("keeps the original when the canvas is unavailable or fails", async () => {
    stubImage("load");
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    getContext.mockReturnValue(null);
    expect(await createFaviconDataUrl("logo.png")).toBe("logo.png");

    getContext.mockImplementation(() => {
      throw new Error("tainted");
    });
    expect(await createFaviconDataUrl("logo.png")).toBe("logo.png");
  });

  it("keeps the original when the image cannot load, or outside a browser", async () => {
    stubImage("error");
    expect(await createFaviconDataUrl("logo.png")).toBe("logo.png");

    vi.stubGlobal("window", undefined);
    expect(await createFaviconDataUrl("logo.png")).toBe("logo.png");
  });

  it("renders a custom logo, or the preset icon as an SVG", async () => {
    stubImage("error");
    expect(await renderFaviconPngDataUrl("book", "#216fc0", "custom.png")).toBe("custom.png");
    expect(await renderFaviconPngDataUrl("book", "#216fc0")).toMatch(/^data:image\/svg\+xml/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { downloadFile } from "@/lib/download";

const fetchMock = vi.fn();
let clicked: HTMLAnchorElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:file");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked = this;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  clicked = null;
});

function fileResponse(disposition: string | null) {
  const headers = new Headers();
  if (disposition) headers.set("content-disposition", disposition);
  return new Response("x", { status: 200, headers });
}

describe("downloadFile", () => {
  it("saves the body under the server's filename, decoding UTF-8 names", async () => {
    fetchMock.mockResolvedValueOnce(
      fileResponse("attachment; filename=\"page.docx\"; filename*=UTF-8''H%C6%B0%E1%BB%9Bng.docx"),
    );
    await downloadFile("/x", "fallback.docx");
    expect(fetchMock).toHaveBeenCalledWith("/x", { credentials: "include" });
    expect(clicked?.download).toBe("Hướng.docx");
    expect(clicked?.isConnected).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");
  });

  it("falls back to the plain filename, then to the caller's name", async () => {
    fetchMock.mockResolvedValueOnce(fileResponse("attachment; filename*=UTF-8''%E0%A4%A; filename=\"plain.pdf\""));
    await downloadFile("/x", "fallback.pdf");
    expect(clicked?.download).toBe("plain.pdf");

    fetchMock.mockResolvedValueOnce(fileResponse("inline"));
    await downloadFile("/x", "fallback.pdf");
    expect(clicked?.download).toBe("fallback.pdf");

    fetchMock.mockResolvedValueOnce(fileResponse(null));
    await downloadFile("/x", "none.html");
    expect(clicked?.download).toBe("none.html");
  });

  it("raises the API's error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "service_unavailable", message: "Render failed.", request_id: "r1" },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    const err = await downloadFile("/x", "f").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: "service_unavailable", message: "Render failed.", requestId: "r1" });
  });

  it("describes a non-JSON failure by status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("bad gateway", { status: 502, headers: { "X-Request-ID": "r2" } }),
    );
    const err = await downloadFile("/x", "f").catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 502,
      code: "http_error",
      message: "Request failed with status 502.",
      requestId: "r2",
    });
  });

  it("reports an unreachable server as a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await downloadFile("/x", "f").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: "network_error" });
  });
});

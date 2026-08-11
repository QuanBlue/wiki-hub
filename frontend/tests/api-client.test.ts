import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, apiFetch } from "@/lib/api-client";

function mockFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

/** Await a rejected request and narrow the failure to an ApiError. */
async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("apiFetch", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(jsonResponse({ site_name: "WikiHub" }));

    await expect(apiFetch("/api/v1/meta")).resolves.toEqual({
      site_name: "WikiHub",
    });
  });

  it("appends query parameters and drops empty ones", async () => {
    const spy = mockFetch(jsonResponse({}));

    await apiFetch("/api/v1/search", {
      query: { q: "runbook", space: undefined, page: 2, empty: "" },
    });

    const url = new URL(spy.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/search");
    expect(url.searchParams.get("q")).toBe("runbook");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("space")).toBe(false);
    expect(url.searchParams.has("empty")).toBe(false);
  });

  it("unwraps the standard error envelope", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "permission_denied",
            message: "Nope.",
            details: { permission: "PAGE_EDIT" },
            request_id: "req-1",
          },
        },
        403,
      ),
    );

    const error = await expectApiError(apiFetch("/api/v1/pages/1"));

    expect(error.status).toBe(403);
    expect(error.code).toBe("permission_denied");
    expect(error.message).toBe("Nope.");
    expect(error.details).toEqual({ permission: "PAGE_EDIT" });
    expect(error.requestId).toBe("req-1");
    expect(error.isRetryable).toBe(false);
  });

  it("marks 5xx and 429 as retryable", async () => {
    mockFetch(
      jsonResponse({ error: { code: "rate_limited", message: "x" } }, 429),
    );
    const error = await expectApiError(apiFetch("/api/v1/auth/login"));
    expect(error.isRetryable).toBe(true);
  });

  it("reports a network failure as a network_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("boom")));

    const error = await expectApiError(apiFetch("/api/v1/meta"));

    expect(error.code).toBe("network_error");
    expect(error.status).toBe(0);
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/v1/pages/1")).resolves.toBeUndefined();
  });

  it("serialises JSON bodies and sets the content type", async () => {
    const spy = mockFetch(jsonResponse({ id: "1" }));

    await api.post("/api/v1/spaces", { key: "ENG", name: "Engineering" });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"key":"ENG","name":"Engineering"}');
    expect((init.headers as Headers).get("Content-Type")).toBe(
      "application/json",
    );
  });
});

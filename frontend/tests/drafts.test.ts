import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearLocalPageDraft,
  discardPageDraft,
  getLocalPageDraft,
  getPageDraft,
  saveLocalPageDraft,
  savePageDraft,
} from "@/lib/drafts";

const draft = {
  content: "<p>Draft</p>",
  content_format: "html" as const,
  edit_mode: "html" as const,
  base_updated_at: "2026-01-01T00:00:00Z",
};

afterEach(() => vi.restoreAllMocks());

describe("page drafts", () => {
  it("round-trips local drafts and clears them", () => {
    saveLocalPageDraft("team space", "my/page", draft);
    const stored = getLocalPageDraft("team space", "my/page");
    expect(stored).toMatchObject(draft);
    expect(stored?.saved_at).toEqual(expect.any(String));

    clearLocalPageDraft("team space", "my/page");
    expect(getLocalPageDraft("team space", "my/page")).toBeNull();
  });

  it("handles unavailable or corrupt local storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveLocalPageDraft("space", "slug", draft)).not.toThrow();

    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("not json");
    expect(getLocalPageDraft("space", "slug")).toBeNull();
  });

  it("is safe to call during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveLocalPageDraft("space", "slug", draft)).not.toThrow();
    expect(getLocalPageDraft("space", "slug")).toBeNull();
    expect(() => clearLocalPageDraft("space", "slug")).not.toThrow();
  });

  it("uses encoded API paths for get, save and discard", async () => {
    const api = await import("@/lib/api-client");
    const get = vi.spyOn(api.api, "get").mockResolvedValue(null);
    const put = vi.spyOn(api.api, "put").mockResolvedValue(draft);
    const del = vi.spyOn(api.api, "delete").mockResolvedValue(undefined);

    await getPageDraft("team space", "my/page");
    await savePageDraft("team space", "my/page", draft, { keepalive: true });
    await discardPageDraft("team space", "my/page");

    const path = "/api/v1/spaces/team%20space/pages/my%2Fpage/draft";
    expect(get).toHaveBeenCalledWith(path);
    expect(put).toHaveBeenCalledWith(path, draft, { keepalive: true });
    expect(del).toHaveBeenCalledWith(path);
  });
});

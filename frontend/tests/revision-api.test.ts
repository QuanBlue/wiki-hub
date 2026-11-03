import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPageRevision,
  getRevisionDiff,
  getRevisionDiffSummary,
  listPageRevisions,
  restorePageRevision,
} from "@/lib/revisions";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe("revision API", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("encodes page identity and version in read and restore routes", async () => {
    vi.mocked(api.get).mockResolvedValue({});
    vi.mocked(api.post).mockResolvedValue({});
    await listPageRevisions("ENG Docs", "a/b");
    await getPageRevision("ENG Docs", "a/b", 3);
    await restorePageRevision("ENG Docs", "a/b", 2);
    expect(api.get).toHaveBeenNthCalledWith(1, "/api/v1/spaces/ENG%20Docs/pages/a%2Fb/revisions");
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/v1/spaces/ENG%20Docs/pages/a%2Fb/revisions/3");
    expect(api.post).toHaveBeenCalledWith("/api/v1/spaces/ENG%20Docs/pages/a%2Fb/revisions/2/restore");
  });

  it("builds a diff with optional version bounds and sends summary payload", async () => {
    vi.mocked(api.get).mockResolvedValue({});
    vi.mocked(api.post).mockResolvedValue({});
    await getRevisionDiff("ENG", "runbook");
    await getRevisionDiff("ENG", "runbook", 1, 4);
    const payload = { from_version: 1, to_version: 4, prompt: "Summarize" };
    await getRevisionDiffSummary("ENG", "runbook", payload);
    expect(api.get).toHaveBeenNthCalledWith(1, "/api/v1/spaces/ENG/pages/runbook/revisions/diff");
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/v1/spaces/ENG/pages/runbook/revisions/diff?from_version=1&to_version=4");
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/spaces/ENG/pages/runbook/diff-summary", payload);
  });
});

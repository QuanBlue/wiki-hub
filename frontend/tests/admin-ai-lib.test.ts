import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverGetMock } = vi.hoisted(() => ({ serverGetMock: vi.fn() }));
vi.mock("@/lib/server-api", () => ({ serverGet: serverGetMock }));

import {
  getAiConnections,
  getAiPageDraftSkill,
  getAiSkill,
  getAiSummarySkill,
} from "@/lib/admin-ai";

describe("admin AI loaders", () => {
  beforeEach(() => serverGetMock.mockReset().mockResolvedValue({ ok: true }));

  it.each([
    ["connections", () => getAiConnections(), "/api/v1/ai/connections"],
    ["summary skill", () => getAiSummarySkill(), "/api/v1/ai/skills/summary"],
    ["page-draft skill", () => getAiPageDraftSkill(), "/api/v1/ai/skills/page-draft"],
    ["writing skill", () => getAiSkill("writing"), "/api/v1/ai/skills/writing"],
    ["explain skill", () => getAiSkill("selection-explain"), "/api/v1/ai/skills/selection-explain"],
  ])("fetches the %s", async (_label, load, path) => {
    await expect(load()).resolves.toEqual({ ok: true });
    expect(serverGetMock).toHaveBeenCalledWith(path);
  });
});

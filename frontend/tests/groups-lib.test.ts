import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverGetMock } = vi.hoisted(() => ({ serverGetMock: vi.fn() }));
vi.mock("@/lib/server-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server-api")>("@/lib/server-api");
  return { ...actual, serverGet: serverGetMock };
});

import { listGroups } from "@/lib/groups";

describe("listGroups", () => {
  beforeEach(() => serverGetMock.mockReset());

  it("fetches without a query when none is given", async () => {
    serverGetMock.mockResolvedValue([]);

    await listGroups();

    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/groups");
  });

  it("passes a search term through as a query parameter", async () => {
    serverGetMock.mockResolvedValue([]);

    await listGroups("eng");

    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/groups?q=eng");
  });
});

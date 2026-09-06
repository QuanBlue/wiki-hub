import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverGetMock } = vi.hoisted(() => ({ serverGetMock: vi.fn() }));
vi.mock("@/lib/server-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server-api")>("@/lib/server-api");
  return { ...actual, serverGet: serverGetMock };
});

import { getSiteSettings, listAllUsers, listUsers } from "@/lib/admin";

function user(id: string) {
  return { id, username: id };
}

describe("listUsers", () => {
  beforeEach(() => serverGetMock.mockReset());

  it("defaults to the first page of 25", async () => {
    serverGetMock.mockResolvedValue({ items: [], total: 0 });

    await listUsers();

    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/users?limit=25&offset=0");
  });

  it("forwards the search/filter/paging params given", async () => {
    serverGetMock.mockResolvedValue({ items: [], total: 0 });

    await listUsers({ q: "ali", status: "active", role: "admin", limit: 10, offset: 20 });

    expect(serverGetMock).toHaveBeenCalledWith(
      "/api/v1/users?q=ali&status=active&role=admin&limit=10&offset=20",
    );
  });
});

describe("listAllUsers", () => {
  beforeEach(() => serverGetMock.mockReset());

  it("stops after one page when it already covers every user", async () => {
    serverGetMock.mockResolvedValue({ items: [user("1"), user("2")], total: 2 });

    const result = await listAllUsers();

    expect(result).toHaveLength(2);
    expect(serverGetMock).toHaveBeenCalledTimes(1);
  });

  it("keeps paging until every user has been collected", async () => {
    serverGetMock
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => user(String(i))),
        total: 250,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, i) => user(String(200 + i))),
        total: 250,
      });

    const result = await listAllUsers();

    expect(result).toHaveLength(250);
    expect(serverGetMock).toHaveBeenCalledTimes(2);
    expect(serverGetMock).toHaveBeenNthCalledWith(2, "/api/v1/users?limit=200&offset=200");
  });

  it("also stops if a short page arrives even though the reported total is higher", async () => {
    // Defensive against an inconsistent total - a page shorter than the
    // requested limit means there is nothing left to fetch regardless.
    serverGetMock.mockResolvedValue({ items: [user("1")], total: 999 });

    const result = await listAllUsers();

    expect(result).toHaveLength(1);
    expect(serverGetMock).toHaveBeenCalledTimes(1);
  });
});

describe("getSiteSettings", () => {
  it("fetches the site settings", async () => {
    serverGetMock.mockReset();
    serverGetMock.mockResolvedValue({ site_name: "WikiHub" });

    expect(await getSiteSettings()).toEqual({ site_name: "WikiHub" });
    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/settings");
  });
});

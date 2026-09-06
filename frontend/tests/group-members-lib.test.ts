import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: apiGetMock } }));

import { listGroupMembers } from "@/lib/group-members";

describe("listGroupMembers", () => {
  beforeEach(() => apiGetMock.mockReset());

  it("fetches the members of the given group", async () => {
    apiGetMock.mockResolvedValue([{ id: "u1" }]);

    const result = await listGroupMembers("g1");

    expect(result).toEqual([{ id: "u1" }]);
    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/groups/g1/members");
  });

  it("encodes a group id containing special characters", async () => {
    apiGetMock.mockResolvedValue([]);

    await listGroupMembers("group/with slash");

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/groups/group%2Fwith%20slash/members");
  });
});

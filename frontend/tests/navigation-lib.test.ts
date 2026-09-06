import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverGetMock } = vi.hoisted(() => ({ serverGetMock: vi.fn() }));
vi.mock("@/lib/server-api", () => ({
  serverGet: serverGetMock,
  queryString: (params: Record<string, unknown>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    const rendered = search.toString();
    return rendered ? `?${rendered}` : "";
  },
}));

import { getSidebarPermissions } from "@/lib/navigation";

describe("getSidebarPermissions", () => {
  beforeEach(() => serverGetMock.mockReset());

  it("fetches the sidebar permissions and unwraps the envelope", async () => {
    serverGetMock.mockResolvedValue({ permissions: { admin: true } });

    const result = await getSidebarPermissions();

    expect(result).toEqual({ admin: true });
    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/settings/sidebar-permissions");
  });
});

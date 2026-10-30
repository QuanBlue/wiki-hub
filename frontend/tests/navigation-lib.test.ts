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

import { getSidebarPermissions, getSystemAnnouncement } from "@/lib/navigation";

describe("getSidebarPermissions", () => {
  beforeEach(() => serverGetMock.mockReset());

  it("fetches the sidebar permissions and unwraps the envelope", async () => {
    serverGetMock.mockResolvedValue({ permissions: { admin: true } });

    const result = await getSidebarPermissions();

    expect(result).toEqual({ admin: true });
    expect(serverGetMock).toHaveBeenCalledWith("/api/v1/settings/sidebar-permissions");
  });

  it("fetches the active system announcement and falls back to null on error", async () => {
    const ann = {
      enabled: true,
      level: "info",
      title: "Release v2.5",
      content_html: "<p>Scheduled maintenance</p>",
      starts_at: null,
      expires_at: null,
      dismissible: true,
      show_on_login: true,
      updated_at: "2026-10-30T10:00:00Z",
    };
    serverGetMock.mockResolvedValueOnce({ announcement: ann });
    expect(await getSystemAnnouncement()).toEqual(ann);

    serverGetMock.mockRejectedValueOnce(new Error("unavailable"));
    expect(await getSystemAnnouncement()).toBeNull();
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdministratorsTable } from "@/components/admin/administrators-table";
import { api } from "@/lib/api-client";
import type { AdminAccount } from "@/types/api";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { patch: vi.fn() },
}));

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(api.patch).mockReset();
});

function admin(overrides: Partial<AdminAccount> = {}): AdminAccount {
  return {
    id: "u-1",
    username: "quanvnh",
    email: "quanvnh@example.test",
    full_name: "Quan VNH",
    avatar_url: null,
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
    is_active: true,
    is_superuser: false,
    is_effective_admin: true,
    is_protected: false,
    last_login_at: null,
    created_at: "2026-09-01T00:00:00Z",
    groups: [],
    admin_source: "override",
    granted_by: "quannt39",
    granted_via_group: null,
    ...overrides,
  } as AdminAccount;
}

async function demote(user: ReturnType<typeof userEvent.setup>, username: string) {
  const row = screen.getByText(`@${username}`).closest("tr") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: "Demote to Member" }));
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Demote to Member" }));
}

describe("AdministratorsTable", () => {
  it("drops the row as soon as the server confirms the demote, without waiting on router.refresh", async () => {
    vi.mocked(api.patch).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[admin({ id: "u-1", username: "quanvnh" }), admin({ id: "u-2", username: "ada" })]}
        meId="u-2"
        viewerIsProtected={false}
      />,
    );

    await demote(user, "quanvnh");

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", {
      global_permission_overrides: { system_admin: false },
    });
    // Gone immediately - this does not depend on `router.refresh()` having
    // resolved and handed back a new `admins` prop yet.
    expect(screen.queryByText("@quanvnh")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("flips is_superuser off for a Role-based administrator", async () => {
    vi.mocked(api.patch).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[
          admin({ id: "u-1", username: "hientp1", admin_source: "superuser", is_superuser: true }),
          admin({ id: "u-2", username: "ada" }),
        ]}
        meId="u-2"
        // Demoting a Role-based peer administrator is otherwise blocked -
        // only the protected super administrator may do it.
        viewerIsProtected
      />,
    );

    await demote(user, "hientp1");

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", { is_superuser: false });
    expect(screen.queryByText("@hientp1")).toBeNull();
  });

  it("keeps a row the server rejected", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[admin({ id: "u-1", username: "quanvnh" }), admin({ id: "u-2", username: "ada" })]}
        meId="u-2"
        viewerIsProtected={false}
      />,
    );

    await demote(user, "quanvnh");

    expect(screen.getByText("@quanvnh")).toBeInTheDocument();
  });

  it("stays in sync when the admins prop changes from a real navigation", () => {
    const { rerender } = render(
      <AdministratorsTable
        admins={[admin({ id: "u-1", username: "quanvnh" })]}
        meId="u-2"
        viewerIsProtected={false}
      />,
    );
    expect(screen.getByText("@quanvnh")).toBeInTheDocument();

    rerender(
      <AdministratorsTable
        admins={[admin({ id: "u-2", username: "ada" })]}
        meId="u-2"
        viewerIsProtected={false}
      />,
    );

    expect(screen.queryByText("@quanvnh")).toBeNull();
    expect(screen.getByText("@ada")).toBeInTheDocument();
  });
});

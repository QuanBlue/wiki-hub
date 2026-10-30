import { render, screen, waitFor, within } from "@testing-library/react";
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
    receive_admin_emails: true,
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

  it("toggles receive_admin_emails off and on for an administrator", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ receive_admin_emails: false } as any);
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[admin({ id: "u-1", username: "boss", receive_admin_emails: true })]}
        meId="u-1"
        viewerIsProtected={false}
      />,
    );

    const toggleBtn = screen.getByRole("switch", { name: /disable email notifications for boss/i });
    expect(toggleBtn).toHaveAttribute("aria-checked", "true");

    await user.click(toggleBtn);

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", {
      receive_admin_emails: false,
    });

    // Switch should now reflect disabled state
    const mutedBtn = screen.getByRole("switch", { name: /enable email notifications for boss/i });
    expect(mutedBtn).toHaveAttribute("aria-checked", "false");

    // Toggle back on
    vi.mocked(api.patch).mockResolvedValueOnce({ receive_admin_emails: true } as any);
    await user.click(mutedBtn);

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", {
      receive_admin_emails: true,
    });
  });

  it("handles failure when toggling receive_admin_emails", async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[admin({ id: "u-1", username: "boss", receive_admin_emails: true })]}
        meId="u-1"
        viewerIsProtected={false}
      />,
    );

    const toggleBtn = screen.getByRole("switch", { name: /disable email notifications for boss/i });
    await user.click(toggleBtn);

    expect(toggleBtn).toHaveAttribute("aria-checked", "true");
  });

  it("allows toggling email notifications for any admin and isolates pending state", async () => {
    let resolvePatch: (value: any) => void;
    vi.mocked(api.patch).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[
          admin({ id: "u-1", username: "boss", is_superuser: true, is_protected: true, receive_admin_emails: true }),
          admin({ id: "u-2", username: "staff", is_superuser: true, receive_admin_emails: true }),
        ]}
        meId="u-2"
        viewerIsProtected={false}
      />,
    );

    const bossBtn = screen.getByRole("switch", { name: /disable email notifications for boss/i });
    const staffBtn = screen.getByRole("switch", { name: /disable email notifications for staff/i });

    // Both are enabled to toggle
    expect(bossBtn).not.toBeDisabled();
    expect(staffBtn).not.toBeDisabled();

    // Click boss toggle
    await user.click(bossBtn);

    // Only boss button is pending/disabled; staff button does NOT flicker/disable
    expect(bossBtn).toBeDisabled();
    expect(staffBtn).not.toBeDisabled();

    // Complete the patch
    resolvePatch!({ receive_admin_emails: false });
    await waitFor(() => {
      expect(bossBtn).not.toBeDisabled();
    });
  });
});

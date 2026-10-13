import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdministratorsSummary, AdministratorsTable } from "@/components/admin/administrators-table";
import type { AdminAccount } from "@/types/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { patch: vi.fn() },
}));

function admin(id: string, overrides: Partial<AdminAccount> = {}): AdminAccount {
  return {
    id,
    username: `user${id}`,
    email: `${id}@example.test`,
    full_name: `User ${id}`,
    is_superuser: false,
    is_protected: false,
    admin_source: "override",
    granted_by: "someone",
    granted_via_group: null,
    ...overrides,
  } as AdminAccount;
}

const rowOf = (username: string) => screen.getByText(`@${username}`).closest("tr") as HTMLElement;
const demoteButton = (username: string) => within(rowOf(username)).getByRole("button", { name: "Demote to Member" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdministratorsTable", () => {
  it("explains when nobody holds system_admin", () => {
    render(<AdministratorsTable admins={[]} meId="x" viewerIsProtected={false} />);
    expect(screen.getByText("No system administrator")).toBeInTheDocument();
  });

  it("names where each grant comes from and why a demote is blocked", () => {
    render(
      <AdministratorsTable
        admins={[
          admin("1", { is_protected: true, full_name: "", admin_source: "superuser" }),
          admin("2"),
          admin("3", { admin_source: "group", granted_by: null, granted_via_group: "Ops" }),
          admin("4", { granted_by: null }),
          admin("5", { is_superuser: true, admin_source: "superuser" }),
        ]}
        meId="2"
        viewerIsProtected={false}
      />,
    );
    expect(screen.getByText("protected")).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("Via group")).toBeInTheDocument();
    expect(screen.getByText(/predates tracking/)).toBeInTheDocument();
    expect(screen.getAllByText("Administrator role").length).toBe(2);

    expect(demoteButton("user1")).toHaveAttribute("title", "The built-in administrator account is protected.");
    expect(demoteButton("user2")).toHaveAttribute("title", "You cannot demote your own account.");
    expect(demoteButton("user5")).toHaveAttribute("title", expect.stringContaining("built-in super administrator"));
    expect(demoteButton("user3")).toBeEnabled();
  });

  it("lets the protected administrator demote another administrator", () => {
    render(
      <AdministratorsTable
        admins={[admin("1"), admin("5", { is_superuser: true, admin_source: "superuser" })]}
        meId="1"
        viewerIsProtected
      />,
    );
    expect(demoteButton("user5")).toBeEnabled();
  });

  it("refuses to demote the only administrator", () => {
    render(<AdministratorsTable admins={[admin("1")]} meId="9" viewerIsProtected={false} />);
    expect(demoteButton("user1")).toBeDisabled();
    expect(demoteButton("user1")).toHaveAttribute("title", expect.stringContaining("only system administrator"));
  });

  it("describes the effect of a demote in the confirmation, and can be dismissed", async () => {
    const actor = userEvent.setup();
    render(
      <AdministratorsTable
        admins={[admin("1"), admin("2", { is_superuser: true, admin_source: "superuser" })]}
        meId="9"
        viewerIsProtected
      />,
    );
    await actor.click(demoteButton("user2"));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/sets their Role to Member/)).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await actor.click(demoteButton("user1"));
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/force-disables system_admin/)).toBeInTheDocument();
  });
});

describe("AdministratorsSummary", () => {
  it("pluralises", () => {
    const one = render(<AdministratorsSummary count={1} />);
    expect(screen.getByText(/1 account currently holds/)).toBeInTheDocument();
    one.unmount();
    render(<AdministratorsSummary count={2} />);
    expect(screen.getByText(/2 accounts currently hold system_admin/)).toBeInTheDocument();
  });
});

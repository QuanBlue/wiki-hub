import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SwitchAccountMenu } from "@/components/layout/switch-account-dialog";
import { api } from "@/lib/api-client";
import type { Me, Page, User } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockCurrentUser: Me = {
  id: "u-admin",
  username: "admin",
  full_name: "WikiHub Administrator",
  email: "admin@example.com",
  avatar_url: null,
  is_active: true,
  is_superuser: true,
  global_permissions: ["system_admin"],
  impersonator: null,
} as unknown as Me;

const mockUsers: User[] = [
  {
    id: "u-1",
    username: "admin_quannt39",
    full_name: "Quan Nguyen",
    email: "quannt39@example.com",
    avatar_url: null,
    is_active: true,
    is_superuser: false,
    is_protected: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as unknown as User,
  {
    id: "u-2",
    username: "banghn",
    full_name: "Bang Hoang",
    email: "banghn@example.com",
    avatar_url: null,
    is_active: true,
    is_superuser: false,
    is_protected: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as unknown as User,
  {
    id: "u-3",
    username: "baohl",
    full_name: "Bao Hoang",
    email: "baohl@example.com",
    avatar_url: null,
    is_active: true,
    is_superuser: false,
    is_protected: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as unknown as User,
];

describe("SwitchAccountMenu popup with search filter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens popup beside dropdown and filters users by name or username", async () => {
    const user = userEvent.setup();
    const onSwitched = vi.fn();

    // The menu searches the backend, so the mock applies `q` the way the
    // users endpoint does: a substring match on name or username.
    const getSpy = vi.spyOn(api, "get").mockImplementation(async (url) => {
      const q = new URL(String(url), "http://test").searchParams
        .get("q")
        ?.toLowerCase();
      const items = q
        ? mockUsers.filter(
            (u) =>
              u.username.toLowerCase().includes(q) ||
              (u.full_name ?? "").toLowerCase().includes(q),
          )
        : mockUsers;
      return { items, total: items.length, limit: 100, offset: 0 } as Page<User>;
    });

    const postSpy = vi.spyOn(api, "post").mockResolvedValueOnce({});

    render(
      <SwitchAccountMenu
        currentUser={mockCurrentUser}
        canSwitch={true}
        onSwitched={onSwitched}
      />,
    );

    // Initial state: only current user row is rendered, no search input
    expect(screen.getByText("WikiHub Administrator")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/filter by name/i)).not.toBeInTheDocument();

    // Click switch button
    const switchBtn = screen.getByRole("button", { name: /switch account/i });
    await user.click(switchBtn);

    // Popup opens: search input and users are visible
    const searchInput = await screen.findByPlaceholderText(/filter by name/i);
    expect(searchInput).toBeInTheDocument();
    expect(screen.getByText("Quan Nguyen")).toBeInTheDocument();
    expect(screen.getByText("Bang Hoang")).toBeInTheDocument();
    expect(screen.getByText("Bao Hoang")).toBeInTheDocument();

    // Type filter query "bang"
    await user.type(searchInput, "bang");

    // The debounced search hits the backend with the query, and only the
    // matching user is shown once it answers.
    await waitFor(() => {
      expect(getSpy).toHaveBeenLastCalledWith(
        expect.stringContaining("q=bang"),
      );
      expect(screen.queryByText("Quan Nguyen")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Bang Hoang")).toBeInTheDocument();
    expect(screen.queryByText("Bao Hoang")).not.toBeInTheDocument();

    // Click on matching user to switch
    window.localStorage.setItem("wikihub:chat:v1:admin", "[]");
    await user.click(screen.getByText("Bang Hoang"));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/api/v1/auth/impersonate", {
        user_id: "u-2",
      });
      expect(onSwitched).toHaveBeenCalledTimes(1);
    });
    // The administrator's own conversation does not follow into the other account.
    expect(window.localStorage.getItem("wikihub:chat:v1:admin")).toBeNull();
  });
});

describe("SwitchAccountMenu - edge cases", () => {
  const page = (items: User[]) => ({ items, total: items.length, limit: 100, offset: 0 }) as Page<User>;

  async function openMenu(current: Me = mockCurrentUser) {
    const user = userEvent.setup();
    render(<SwitchAccountMenu currentUser={current} canSwitch onSwitched={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /switch account/i }));
    return user;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the current user's picture instead of initials", () => {
    render(
      <SwitchAccountMenu currentUser={{ ...mockCurrentUser, avatar_url: "/me.png" }} canSwitch={false} onSwitched={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /switch account/i })).not.toBeInTheDocument();
  });

  it("reports when accounts cannot be loaded", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("x"));
    await openMenu();
    expect(await screen.findByText(/could not load accounts/i)).toBeInTheDocument();
  });

  it("says there are no other accounts, and offers to clear a search with no match", async () => {
    vi.spyOn(api, "get").mockResolvedValue(page([]));
    const user = await openMenu();
    expect(await screen.findByText(/no other active accounts/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/filter by name/i), "zzz");
    expect(await screen.findByText(/no matching accounts/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear search/i, hidden: true }));
    expect(screen.getByPlaceholderText(/filter by name/i)).toHaveValue("");
  });

  it("uses Escape to clear the search first, then to close", async () => {
    vi.spyOn(api, "get").mockResolvedValue(page(mockUsers));
    const user = await openMenu();
    const search = await screen.findByPlaceholderText(/filter by name/i);
    await user.type(search, "ba");
    await user.keyboard("{Escape}");
    // The popup stays open with an empty search...
    expect(screen.getByPlaceholderText(/filter by name/i)).toHaveValue("");
    // ...and the next Escape closes it.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByPlaceholderText(/filter by name/i)).not.toBeInTheDocument());
  });

  it("shows users' pictures and reports a failed switch", async () => {
    vi.spyOn(api, "get").mockResolvedValue(page([{ ...mockUsers[0], avatar_url: "/q.png" } as User, mockUsers[1]]));
    vi.spyOn(api, "post").mockRejectedValueOnce(new Error("denied"));
    const user = await openMenu();
    await user.click(await screen.findByText("Bang Hoang"));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(await screen.findByText("Bang Hoang")).toBeEnabled?.();
  });
});

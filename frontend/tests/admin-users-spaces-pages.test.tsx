import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminSpacesPage from "@/app/admin/spaces/page";
import AdminUsersPage from "@/app/admin/users/page";
import type { Me, Space, User } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listAllSpaces: vi.fn(),
  listAllUsers: vi.fn(),
  listUsers: vi.fn(),
  listAdministrators: vi.fn(),
  listPermissionOverrideUsers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/spaces", () => ({ listAllSpaces: m.listAllSpaces }));
vi.mock("@/lib/admin", () => ({
  listAllUsers: m.listAllUsers,
  listUsers: m.listUsers,
  listAdministrators: m.listAdministrators,
  listPermissionOverrideUsers: m.listPermissionOverrideUsers,
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/components/admin/list-controls", () => ({
  ListFilters: ({ searchValue }: { searchValue: string }) => (
    <div data-testid="filters">{searchValue}</div>
  ),
  PaginationControls: ({ total, limit, offset }: { total: number; limit: number; offset: number }) => (
    <div data-testid="pager">{`${total}/${limit}/${offset}`}</div>
  ),
}));
vi.mock("@/components/admin/summary-metrics", () => ({
  SummaryMetrics: ({ items }: { items: { label: string; value: number }[] }) => (
    <div data-testid="metrics">{items.map((i) => `${i.label}=${i.value}`).join(",")}</div>
  ),
}));
vi.mock("@/components/admin/space-row-actions", () => ({
  AdminSpaceRow: ({ space }: { space: Space }) => (
    <tr>
      <td>{space.name}</td>
    </tr>
  ),
}));
vi.mock("@/components/spaces/create-space-form", () => ({
  CreateSpaceForm: () => <button>create-space</button>,
}));
vi.mock("@/components/admin/administrators-table", () => ({
  AdministratorsSummary: ({ count }: { count: number }) => <span>admins-summary {count}</span>,
  AdministratorsTable: ({ admins }: { admins: unknown[] }) => <span>admins-table {admins.length}</span>,
}));
vi.mock("@/components/admin/permission-overrides-table", () => ({
  PermissionOverridesSummary: ({ count }: { count: number }) => <span>overrides-summary {count}</span>,
  PermissionOverridesTable: ({ users }: { users: unknown[] }) => <span>overrides-table {users.length}</span>,
}));
vi.mock("@/components/admin/create-user-dialog", () => ({
  CreateUserDialog: ({ viewerIsSystemAdmin }: { viewerIsSystemAdmin: boolean }) => (
    <button>create-user {String(viewerIsSystemAdmin)}</button>
  ),
}));
vi.mock("@/components/admin/refresh-button", () => ({
  RefreshButton: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock("@/components/admin/user-row-actions", () => ({
  UserRowActions: ({ user }: { user: User }) => <span>actions {user.username}</span>,
}));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => <span>{username}</span>,
}));
vi.mock("@/components/admin/bulk-select", () => ({
  BulkSelectionProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BulkDeleteBar: () => <div>bulk-bar</div>,
  SelectModeButton: () => <button>select-mode</button>,
  SelectionColumn: () => <col />,
  SelectionHeaderCell: ({ ids }: { ids: string[] }) => <th data-testid="select-all">{ids.join(",")}</th>,
  SelectionCell: ({ id, disabled, title }: { id: string; disabled?: boolean; title?: string }) => (
    <td data-testid={`select-${id}`} data-disabled={String(!!disabled)} title={title} />
  ),
}));

type Params = Record<string, string | string[] | undefined>;

function admin(overrides: Partial<Me> = {}): Me {
  return {
    id: "me",
    is_superuser: true,
    is_protected: false,
    global_permissions: [],
    ...overrides,
  } as unknown as Me;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue(admin());
});

// ---------------------------------------------------------------- spaces
function makeSpace(n: number, overrides: Partial<Space> = {}): Space {
  return {
    id: `s${n}`,
    key: `K${n}`,
    name: `Space ${n}`,
    description: `desc ${n}`,
    status: "active",
    member_count: n,
    ...overrides,
  } as Space;
}

async function renderSpaces(params: Params = {}) {
  render(await AdminSpacesPage({ searchParams: Promise.resolve(params) }));
}

describe("AdminSpacesPage", () => {
  beforeEach(() => {
    m.listAllUsers.mockResolvedValue([]);
    m.listAllSpaces.mockResolvedValue([
      makeSpace(1),
      makeSpace(2, { status: "archived" }),
      makeSpace(3),
    ]);
  });

  it("asks for permission from anyone who is not a system administrator", async () => {
    m.getCurrentUser.mockResolvedValue(admin({ is_superuser: false, global_permissions: ["manage_users"] } as Partial<Me>));
    await renderSpaces();
    expect(screen.getByText("Permission required")).toBeInTheDocument();
    expect(m.listAllSpaces).not.toHaveBeenCalled();
  });

  it("also asks when nobody is signed in", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await renderSpaces();
    expect(screen.getByText("Permission required")).toBeInTheDocument();
  });

  it("accepts the system_admin permission and lists the directory with totals", async () => {
    m.getCurrentUser.mockResolvedValue(admin({ is_superuser: false, global_permissions: ["system_admin"] } as Partial<Me>));
    await renderSpaces();
    expect(screen.getByTestId("metrics")).toHaveTextContent(
      "Total spaces=3,Active=2,Archived=1,Member assignments=6",
    );
    expect(screen.getByText("Space directory (3)")).toBeInTheDocument();
    expect(screen.getByText("Space 2")).toBeInTheDocument();
    expect(screen.getByTestId("pager")).toHaveTextContent("3/10/0");
    expect(m.listAllSpaces).toHaveBeenCalledWith(true);
  });

  it("shows only archived spaces on that tab", async () => {
    await renderSpaces({ tab: "archived" });
    expect(screen.getByText("Space 2")).toBeInTheDocument();
    expect(screen.queryByText("Space 1")).not.toBeInTheDocument();
    expect(screen.getByText(/Hidden from normal navigation/)).toBeInTheDocument();
  });

  it("explains an empty directory and an empty archive", async () => {
    m.listAllSpaces.mockResolvedValue([]);
    await renderSpaces();
    expect(screen.getByText("No spaces yet")).toBeInTheDocument();
    expect(screen.queryByTestId("pager")).not.toBeInTheDocument();
  });

  it("explains an empty archive", async () => {
    m.listAllSpaces.mockResolvedValue([makeSpace(1)]);
    await renderSpaces({ tab: "archived" });
    expect(screen.getByText("No archived spaces")).toBeInTheDocument();
  });

  it("filters by search, paginates, and sanitises the page size", async () => {
    await renderSpaces({ q: ["  SPACE 3 "], limit: "25", offset: "0" });
    expect(screen.getByText("Space 3")).toBeInTheDocument();
    expect(screen.queryByText("Space 1")).not.toBeInTheDocument();
    expect(screen.getByTestId("pager")).toHaveTextContent("1/25/0");
  });

  it("falls back to defaults for odd paging values and shows no-match text", async () => {
    await renderSpaces({ q: "zzz", limit: "7", offset: "x" });
    expect(screen.getByText("No spaces found")).toBeInTheDocument();
    expect(screen.queryByTestId("pager")).not.toBeInTheDocument();
  });

  it("slices the requested page", async () => {
    m.listAllSpaces.mockResolvedValue(Array.from({ length: 12 }, (_, i) => makeSpace(i + 1)));
    await renderSpaces({ offset: "10" });
    expect(screen.getByText("Space 11")).toBeInTheDocument();
    expect(screen.queryByText("Space 1")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------- users
function makeUser(n: number, overrides: Partial<User> = {}): User {
  return {
    id: `u${n}`,
    username: `user${n}`,
    full_name: `User ${n}`,
    email: `u${n}@example.com`,
    groups: [],
    is_superuser: false,
    is_effective_admin: false,
    is_active: true,
    is_online: false,
    is_protected: false,
    last_login_at: null,
    ...overrides,
  } as unknown as User;
}

async function renderUsers(params: Params = {}) {
  render(await AdminUsersPage({ searchParams: Promise.resolve(params) }));
}

describe("AdminUsersPage", () => {
  beforeEach(() => {
    m.listUsers.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.limit === 1) return { items: [], total: opts.role === "admin" ? 2 : 9, limit: 1, offset: 0 };
      return {
        items: [
          makeUser(1, {
            groups: ["Docs"],
            is_online: true,
            last_login_at: "2026-02-03T04:05:06Z",
          } as Partial<User>),
          makeUser(2, { is_superuser: true, is_protected: true, is_active: false } as Partial<User>),
          makeUser(3, { is_effective_admin: true, last_login_at: "2026-01-01T00:00:00Z" } as Partial<User>),
          makeUser(4, { is_superuser: true } as Partial<User>),
          makeUser(5, { id: "me" }),
        ],
        total: 5,
        limit: 10,
        offset: 0,
      };
    });
    m.listAdministrators.mockResolvedValue([{}, {}]);
    m.listPermissionOverrideUsers.mockResolvedValue([{}]);
  });

  it("requires the manage-users permission", async () => {
    m.getCurrentUser.mockResolvedValue(admin({ is_superuser: false, global_permissions: ["manage_groups"] } as Partial<Me>));
    await renderUsers();
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.listUsers).not.toHaveBeenCalled();
  });

  it("also blocks an anonymous visitor", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await renderUsers();
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
  });

  it("lets a manage_users holder in, but not as a system administrator", async () => {
    m.getCurrentUser.mockResolvedValue(
      admin({ is_superuser: false, global_permissions: ["manage_users"] } as Partial<Me>),
    );
    await renderUsers();
    expect(screen.getByText("create-user false")).toBeInTheDocument();
  });

  it("lets a system_admin permission holder in", async () => {
    m.getCurrentUser.mockResolvedValue(
      admin({ is_superuser: false, global_permissions: ["system_admin"] } as Partial<Me>),
    );
    await renderUsers();
    expect(screen.getByText("create-user true")).toBeInTheDocument();
  });

  it("renders the people directory with presence, roles and selection rules", async () => {
    await renderUsers({ tab: "people", status: "active", role: "member", q: "u" });

    expect(screen.getByTestId("metrics")).toHaveTextContent(
      "adminUsers.totalUsers=9,adminUsers.administrators=2,adminUsers.members=7",
    );
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("adminUsers.presenceOnline")).toBeInTheDocument();
    expect(screen.getAllByText("adminUsers.presenceOffline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("adminUsers.presenceNever").length).toBeGreaterThan(0);
    expect(screen.getByText("adminUsers.youBadge")).toBeInTheDocument();
    expect(screen.getByText("adminUsers.protectedBadge")).toBeInTheDocument();
    expect(screen.getAllByText("adminUsers.adminBadge").length).toBe(3);

    // Protected, self and peer administrators cannot be bulk-selected.
    expect(screen.getByTestId("select-all")).toHaveTextContent("u1,u3");
    expect(screen.getByTestId("select-u2")).toHaveAttribute("title", "adminUsers.protectedAccountTitle");
    expect(screen.getByTestId("select-u4")).toHaveAttribute("title", "adminUsers.onlyBuiltinCanAct");
    expect(screen.getByTestId("select-me")).toHaveAttribute("title", "adminUsers.thisIsYou");
    expect(screen.getByTestId("select-u1")).toHaveAttribute("data-disabled", "false");
    expect(screen.getByTestId("pager")).toHaveTextContent("5/10/0");
  });

  it("lets the protected administrator select other administrators", async () => {
    m.getCurrentUser.mockResolvedValue(admin({ is_protected: true } as Partial<Me>));
    await renderUsers();
    expect(screen.getByTestId("select-all")).toHaveTextContent("u1,u3,u4");
  });

  it("toggles sort direction from the header links", async () => {
    await renderUsers({ sort: "username", order: "asc", q: "x", status: "active", role: "admin", limit: "25" });
    const link = screen.getByTitle("adminUsers.sortBy: adminUsers.columnUser");
    const href = link.getAttribute("href")!;
    expect(href).toContain("sort=username");
    expect(href).toContain("order=desc");
    expect(href).toContain("limit=25");
    expect(href).toContain("q=x");
    expect(link.closest("th")).toHaveAttribute("aria-sort", "ascending");

    const lastLogin = screen.getByTitle("adminUsers.sortBy: adminUsers.columnLastLogin");
    expect(lastLogin.getAttribute("href")).toContain("order=desc");
    expect(screen.getByTitle("adminUsers.sortBy: adminUsers.columnEmail").getAttribute("href")).toContain(
      "order=asc",
    );
  });

  it("marks a descending sort", async () => {
    await renderUsers({ sort: "email", order: "desc" });
    const header = screen.getByTitle("adminUsers.sortBy: adminUsers.columnEmail").closest("th");
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("shows an empty state when no one matches", async () => {
    m.listUsers.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
    await renderUsers({ limit: "999", offset: "bad" });
    expect(screen.getByText("adminUsers.noUsersFound")).toBeInTheDocument();
  });

  it("shows the administrators tab", async () => {
    await renderUsers({ tab: "administrators" });
    expect(screen.getByText("admins-table 2")).toBeInTheDocument();
    expect(screen.getByText("admins-summary 2")).toBeInTheDocument();
  });

  it("shows the permission overrides tab", async () => {
    await renderUsers({ tab: ["overrides"] });
    expect(screen.getByText("overrides-table 1")).toBeInTheDocument();
    expect(screen.getByText("overrides-summary 1")).toBeInTheDocument();
  });
});

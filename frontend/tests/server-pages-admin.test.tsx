import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage from "@/app/account/page";
import AdminIndexPage from "@/app/admin/page";
import AdminBackupPage from "@/app/admin/backup/page";
import AdminGroupsPage from "@/app/admin/groups/page";
import AdminInboxPage from "@/app/admin/inbox/page";
import AdminMailPage from "@/app/admin/mail/page";
import AdminSettingsPage from "@/app/admin/settings/page";
import AdminSpaceAccessPage from "@/app/admin/spaces/[key]/page";
import AdminStoragePage from "@/app/admin/storage/page";
import ContactAdminPage from "@/app/contact-admin/page";
import FavoritesPage from "@/app/favorites/page";
import RecentPage from "@/app/recent/page";
import RecentlyVisitedPage from "@/app/recent/visited/page";
import SavedPage from "@/app/saved/page";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  getMailSummary: vi.fn(),
  listMailboxes: vi.fn(),
  listAdministrators: vi.fn(),
  getSiteSettings: vi.fn(),
  listAllUsers: vi.fn(),
  listGroups: vi.fn(),
  getSpace: vi.fn(),
  listSpacePermissionGroups: vi.fn(),
  listSpacePermissionUsers: vi.fn(),
  listSpacePermissions: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/lib/admin-mail", () => ({
  getMailSummary: m.getMailSummary,
  listMailboxes: m.listMailboxes,
  listAdministrators: m.listAdministrators,
}));
vi.mock("@/lib/admin", () => ({
  getSiteSettings: m.getSiteSettings,
  listAllUsers: m.listAllUsers,
}));
vi.mock("@/lib/groups", () => ({ listGroups: m.listGroups }));
vi.mock("@/lib/spaces", () => ({
  getSpace: m.getSpace,
  listSpacePermissionGroups: m.listSpacePermissionGroups,
  listSpacePermissionUsers: m.listSpacePermissionUsers,
  listSpacePermissions: m.listSpacePermissions,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/account/account-settings", () => ({ AccountSettings: () => <div>account-settings</div> }));
vi.mock("@/components/admin/backup-panel", () => ({ BackupPanel: () => <div>backup-panel</div> }));
vi.mock("@/components/admin/group-manager", () => ({
  GroupManager: ({ initialGroups, users }: { initialGroups: unknown[]; users: unknown[] }) => (
    <div>groups {initialGroups.length}/{users.length}</div>
  ),
}));
vi.mock("@/components/admin/inbox-list", () => ({
  InboxList: ({ openId }: { openId?: string }) => <div>inbox {openId ?? "none"}</div>,
}));
vi.mock("@/components/admin/mailbox-panel", () => ({
  MailboxPanel: (props: Record<string, unknown>) => (
    <div data-testid="mailboxes" data-update={String(props.initialUpdateId)} data-me={String(props.currentUserId)} data-protected={String(props.currentUserIsProtected)} />
  ),
}));
vi.mock("@/components/admin/site-settings-form", () => ({ SiteSettingsForm: () => <div>settings-form</div> }));
vi.mock("@/components/admin/storage-tabs", () => ({ StorageTabs: () => <div>storage-tabs</div> }));
vi.mock("@/components/admin/space-access-panel", () => ({
  SpaceAccessPanel: ({ space }: { space: { name: string } }) => <div>access {space.name}</div>,
}));
vi.mock("@/components/recent/recently-visited-list", () => ({ RecentlyVisitedList: () => <div>visited-list</div> }));
vi.mock("@/components/recent/saved-pages-list", () => ({ SavedPagesList: () => <div>saved-list</div> }));

function me(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    is_superuser: false,
    is_protected: false,
    global_permissions: [],
    ...overrides,
  } as unknown as Me;
}

const sysadmin = () => me({ global_permissions: ["system_admin"] } as Partial<Me>);

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue(me());
  m.getMailSummary.mockResolvedValue({ has_inbox: true });
  m.listMailboxes.mockResolvedValue([]);
  m.listAdministrators.mockResolvedValue([]);
  m.getSiteSettings.mockResolvedValue({});
  m.listAllUsers.mockResolvedValue([{}, {}]);
  m.listGroups.mockResolvedValue([{}]);
  m.getSpace.mockResolvedValue({ name: "Engineering" });
  m.listSpacePermissionGroups.mockResolvedValue([]);
  m.listSpacePermissionUsers.mockResolvedValue([]);
  m.listSpacePermissions.mockResolvedValue([]);
});

describe("redirect-only pages", () => {
  it.each([
    ["contact-admin", () => ContactAdminPage(), "/login?view=contact"],
    ["favorites", () => FavoritesPage(), "/spaces?tab=starred"],
    ["recent", () => RecentPage(), "/"],
  ])("%s sends old links to their new home", (_name, page, target) => {
    expect(() => page()).toThrow(`redirect:${target}`);
  });
});

describe("AdminIndexPage", () => {
  it.each([
    ["a system administrator", sysadmin(), "/admin/users"],
    ["a superuser", me({ is_superuser: true }), "/admin/users"],
    ["a user manager", me({ global_permissions: ["manage_users"] } as Partial<Me>), "/admin/users"],
    ["a group manager", me({ global_permissions: ["manage_groups"] } as Partial<Me>), "/admin/groups"],
    ["an issues manager", me({ global_permissions: ["manage_issues"] } as Partial<Me>), "/admin/issues"],
    ["someone with no permissions", me(), "/admin/users"],
    ["nobody", null, "/admin/users"],
  ])("lands %s on the first usable section", async (_who, user, target) => {
    m.getCurrentUser.mockResolvedValue(user);
    await expect(AdminIndexPage()).rejects.toThrow(`redirect:${target}`);
  });
});

describe("pages that need a signed-in user", () => {
  it.each([
    ["account", () => AccountPage()],
    ["recently visited", () => RecentlyVisitedPage()],
    ["saved", () => SavedPage()],
  ])("%s redirects anonymous visitors", async (_name, page) => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("redirect:/login");
  });

  it("renders the account, visited and saved pages", async () => {
    render(await AccountPage());
    expect(screen.getByText("account-settings")).toBeInTheDocument();
    expect(screen.getByText("account.pageTitle")).toBeInTheDocument();
    document.body.innerHTML = "";
    render(await RecentlyVisitedPage());
    expect(screen.getByText("visited-list")).toBeInTheDocument();
    document.body.innerHTML = "";
    render(await SavedPage());
    expect(screen.getByText("saved-list")).toBeInTheDocument();
  });
});

describe("system-administrator-only admin pages", () => {
  it.each([
    ["backup", () => AdminBackupPage(), "backup-panel"],
    ["settings", () => AdminSettingsPage(), "settings-form"],
    ["storage", () => AdminStoragePage(), "storage-tabs"],
  ])("%s refuses everyone else and serves administrators", async (_name, page, content) => {
    m.getCurrentUser.mockResolvedValue(me({ global_permissions: ["manage_users"] } as Partial<Me>));
    render(await page());
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
    document.body.innerHTML = "";

    m.getCurrentUser.mockResolvedValue(null);
    render(await page());
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    document.body.innerHTML = "";

    m.getCurrentUser.mockResolvedValue(me({ is_superuser: true }));
    render(await page());
    expect(screen.getByText(content)).toBeInTheDocument();
    document.body.innerHTML = "";

    m.getCurrentUser.mockResolvedValue(sysadmin());
    render(await page());
    expect(screen.getByText(content)).toBeInTheDocument();
  });
});

describe("AdminGroupsPage", () => {
  it("requires the manage-groups permission", async () => {
    m.getCurrentUser.mockResolvedValue(me({ global_permissions: ["manage_users"] } as Partial<Me>));
    render(await AdminGroupsPage());
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.listGroups).not.toHaveBeenCalled();
  });

  it.each([
    ["a superuser", me({ is_superuser: true })],
    ["a system administrator", sysadmin()],
    ["a group manager", me({ global_permissions: ["manage_groups"] } as Partial<Me>)],
  ])("lists groups for %s", async (_who, user) => {
    m.getCurrentUser.mockResolvedValue(user);
    render(await AdminGroupsPage());
    expect(screen.getByText("groups 1/2")).toBeInTheDocument();
    document.body.innerHTML = "";
  });

  it("refuses an anonymous visitor", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    render(await AdminGroupsPage());
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
  });
});

describe("AdminInboxPage", () => {
  it("shows the inbox for an administrator with a mailbox", async () => {
    render(await AdminInboxPage({ searchParams: Promise.resolve({ request: "r1" }) }));
    expect(screen.getByText("inbox r1")).toBeInTheDocument();
  });

  it("ignores a repeated request parameter", async () => {
    render(await AdminInboxPage({ searchParams: Promise.resolve({ request: ["a", "b"] }) }));
    expect(screen.getByText("inbox none")).toBeInTheDocument();
  });

  it("explains when there is no mailbox", async () => {
    m.getMailSummary.mockResolvedValue({ has_inbox: false });
    render(await AdminInboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("adminInbox.noMailboxTitle")).toBeInTheDocument();
  });
});

describe("AdminMailPage", () => {
  it("refuses anyone but a system administrator", async () => {
    render(await AdminMailPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.listMailboxes).not.toHaveBeenCalled();
  });

  it("shows the mailboxes with the current account's details", async () => {
    m.getCurrentUser.mockResolvedValue(me({ is_superuser: true, is_protected: true } as Partial<Me>));
    render(await AdminMailPage({ searchParams: Promise.resolve({ update: "u9" }) }));
    const panel = screen.getByTestId("mailboxes");
    expect(panel).toHaveAttribute("data-update", "u9");
    expect(panel).toHaveAttribute("data-me", "u1");
    expect(panel).toHaveAttribute("data-protected", "true");
  });

  it("copes with an anonymous visitor on a bad parameter", async () => {
    m.getCurrentUser.mockResolvedValue(sysadmin());
    render(await AdminMailPage({ searchParams: Promise.resolve({ update: ["x"] }) }));
    expect(screen.getByTestId("mailboxes")).toHaveAttribute("data-update", "undefined");
    expect(screen.getByTestId("mailboxes")).toHaveAttribute("data-protected", "false");
  });
});

describe("AdminSpaceAccessPage", () => {
  it("loads the space with its principals and assignments", async () => {
    render(await AdminSpaceAccessPage({ params: Promise.resolve({ key: "ENG" }) }));
    expect(screen.getByText("access Engineering")).toBeInTheDocument();
    expect(m.getSpace).toHaveBeenCalledWith("ENG");
    expect(m.listSpacePermissions).toHaveBeenCalledWith("ENG");
  });
});

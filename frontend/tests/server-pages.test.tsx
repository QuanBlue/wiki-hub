import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import HomePage from "@/app/page";
import RecentlyWorkedOnPage from "@/app/recent/worked-on/page";
import SpaceDetailPage from "@/app/spaces/[key]/page";
import SpacesPage from "@/app/spaces/page";
import UserProfilePage from "@/app/users/[username]/page";
import { ApiError } from "@/lib/api-client";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  getPublicUser: vi.fn(),
  getUserProfileStats: vi.fn(),
  listRecentPages: vi.fn(),
  listUserActivity: vi.fn(),
  listUserDrafts: vi.fn(),
  listOwnFavoriteSpaces: vi.fn(),
  listOwnPinnedPages: vi.fn(),
  listOwnLikedPages: vi.fn(),
  listPages: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
  listSpaceMembers: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/pages", () => ({
  getPublicUser: m.getPublicUser,
  getUserProfileStats: m.getUserProfileStats,
  listRecentPages: m.listRecentPages,
  listUserActivity: m.listUserActivity,
  listUserDrafts: m.listUserDrafts,
  listOwnFavoriteSpaces: m.listOwnFavoriteSpaces,
  listOwnPinnedPages: m.listOwnPinnedPages,
  listOwnLikedPages: m.listOwnLikedPages,
  listPages: m.listPages,
}));
vi.mock("@/lib/spaces", () => ({
  listSpaces: m.listSpaces,
  getSpace: m.getSpace,
  listSpaceMembers: m.listSpaceMembers,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
vi.mock("@/components/users/user-profile", () => ({
  UserProfile: (props: Record<string, unknown>) => (
    <div
      data-testid="profile"
      data-owner={String(props.isOwner)}
      data-admin={String(props.isAdmin)}
      data-drafts={JSON.stringify(props.drafts)}
      data-favs={JSON.stringify(props.favoriteSpaces)}
      data-pins={JSON.stringify(props.pinnedPages)}
      data-likes={JSON.stringify(props.likedPages)}
    />
  ),
}));
vi.mock("@/components/spaces/create-space-form", () => ({ CreateSpaceForm: () => <button>create-space</button> }));
vi.mock("@/components/spaces/spaces-explorer", () => ({
  SpacesExplorer: ({ spaces }: { spaces: unknown[] }) => <div data-testid="explorer">{spaces.length}</div>,
}));
vi.mock("@/components/pages/space-workspace", () => ({
  SpaceWorkspace: (props: Record<string, unknown>) => (
    <div
      data-testid="workspace"
      data-restrictions={String(props.canManageRestrictions)}
      data-export={String(props.canExport)}
      data-edit={String(props.canEdit)}
    />
  ),
}));

function me(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    username: "Ann",
    is_superuser: false,
    global_permissions: [],
    ...overrides,
  } as unknown as Me;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue(me());
  m.getPublicUser.mockResolvedValue({ username: "ann" });
  m.getUserProfileStats.mockResolvedValue({});
  m.listRecentPages.mockResolvedValue([]);
  m.listUserActivity.mockResolvedValue([]);
  m.listUserDrafts.mockResolvedValue([{ id: "d" }]);
  m.listOwnFavoriteSpaces.mockResolvedValue([{ id: "f" }]);
  m.listOwnPinnedPages.mockResolvedValue([{ id: "p" }]);
  m.listOwnLikedPages.mockResolvedValue([{ id: "l" }]);
});

describe("HomePage", () => {
  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(HomePage()).rejects.toThrow("redirect:/login");
  });

  it("shows the owner's profile, tolerating optional panels failing", async () => {
    m.listUserDrafts.mockRejectedValue(new Error("x"));
    m.listOwnFavoriteSpaces.mockRejectedValue(new Error("x"));
    m.listOwnPinnedPages.mockRejectedValue(new Error("x"));
    m.listOwnLikedPages.mockRejectedValue(new Error("x"));
    render(await HomePage());
    const profile = screen.getByTestId("profile");
    expect(profile).toHaveAttribute("data-owner", "true");
    expect(profile).toHaveAttribute("data-admin", "false");
    expect(profile).toHaveAttribute("data-drafts", "[]");
    expect(profile).toHaveAttribute("data-likes", "[]");
  });

  it("flags administrators", async () => {
    m.getCurrentUser.mockResolvedValue(me({ global_permissions: ["system_admin"] } as Partial<Me>));
    render(await HomePage());
    expect(screen.getByTestId("profile")).toHaveAttribute("data-admin", "true");
  });
});

describe("SpacesPage", () => {
  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(SpacesPage()).rejects.toThrow("redirect:/login");
  });

  it("lists spaces, offering creation only to those allowed", async () => {
    m.listSpaces.mockResolvedValue([{}, {}]);
    render(await SpacesPage());
    expect(screen.getByTestId("explorer")).toHaveTextContent("2");
    expect(screen.queryByText("create-space")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["a superuser", { is_superuser: true }],
    ["create_space", { global_permissions: ["create_space"] }],
  ])("lets %s create spaces", async (_label, overrides) => {
    m.getCurrentUser.mockResolvedValue(me(overrides as Partial<Me>));
    m.listSpaces.mockResolvedValue([]);
    render(await SpacesPage());
    expect(screen.getByText("create-space")).toBeInTheDocument();
  });

  it.each([
    [new ApiError(503, "down", "Unavailable"), /temporarily unavailable/],
    [new ApiError(403, "no", "Not for you"), /Not for you/],
    [new Error("boom"), /Could not load spaces/],
  ])("explains a failure to load spaces (%#)", async (error, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.listSpaces.mockRejectedValue(error);
    render(await SpacesPage());
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByTestId("explorer")).toHaveTextContent("0");
  });
});

describe("AdminLayout", () => {
  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(AdminLayout({ children: <p>inner</p> })).rejects.toThrow("redirect:/login");
  });

  it("explains the missing privilege instead of redirecting", async () => {
    render(await AdminLayout({ children: <p>inner</p> }));
    expect(screen.getByText("Administrator access required")).toBeInTheDocument();
    expect(screen.queryByText("inner")).not.toBeInTheDocument();
  });

  it.each([
    ["superuser", { is_superuser: true }],
    ["system_admin", { global_permissions: ["system_admin"] }],
    ["manage_users", { global_permissions: ["manage_users"] }],
    ["manage_groups", { global_permissions: ["manage_groups"] }],
    ["manage_issues", { global_permissions: ["manage_issues"] }],
  ])("admits %s", async (_label, overrides) => {
    m.getCurrentUser.mockResolvedValue(me(overrides as Partial<Me>));
    render(await AdminLayout({ children: <p>inner</p> }));
    expect(screen.getByText("inner")).toBeInTheDocument();
  });
});

describe("UserProfilePage", () => {
  async function renderFor(username: string) {
    render(await UserProfilePage({ params: Promise.resolve({ username }) }));
  }

  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(renderFor("bob")).rejects.toThrow("redirect:/login");
  });

  it("recognises your own profile regardless of case and loads personal panels", async () => {
    await renderFor("ann");
    const profile = screen.getByTestId("profile");
    expect(profile).toHaveAttribute("data-owner", "true");
    expect(profile).toHaveAttribute("data-drafts", '[{"id":"d"}]');
    expect(profile).toHaveAttribute("data-favs", '[{"id":"f"}]');
  });

  it("shows another member without personal collections", async () => {
    await renderFor("bob");
    const profile = screen.getByTestId("profile");
    expect(profile).toHaveAttribute("data-owner", "false");
    expect(profile).toHaveAttribute("data-drafts", "[]");
    expect(profile).toHaveAttribute("data-pins", "[]");
    expect(m.listUserDrafts).not.toHaveBeenCalled();
  });

  it("lets an administrator see another member's drafts", async () => {
    m.getCurrentUser.mockResolvedValue(me({ is_superuser: true }));
    await renderFor("bob");
    expect(screen.getByTestId("profile")).toHaveAttribute("data-drafts", '[{"id":"d"}]');
  });

  it("copes with optional panels failing", async () => {
    m.listUserDrafts.mockRejectedValue(new Error("x"));
    m.listOwnFavoriteSpaces.mockRejectedValue(new Error("x"));
    await renderFor("ann");
    expect(screen.getByTestId("profile")).toHaveAttribute("data-drafts", "[]");
    expect(screen.getByTestId("profile")).toHaveAttribute("data-favs", "[]");
  });

  it("maps an unknown member to not-found, and rethrows other failures", async () => {
    m.getPublicUser.mockRejectedValueOnce(new ApiError(404, "nf", "missing"));
    await expect(renderFor("ghost")).rejects.toThrow("not-found");

    m.getPublicUser.mockRejectedValueOnce(new ApiError(500, "x", "boom"));
    await expect(renderFor("ghost")).rejects.toThrow("boom");
  });
});

describe("SpaceDetailPage", () => {
  const space = { name: "Engineering", my_permissions: ["restrictions", "export", "add"] };

  async function renderFor(key = "ENG") {
    render(await SpaceDetailPage({ params: Promise.resolve({ key }) }));
  }

  beforeEach(() => {
    m.getSpace.mockResolvedValue(space);
    m.listPages.mockResolvedValue([]);
    m.listSpaceMembers.mockResolvedValue([]);
  });

  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(renderFor()).rejects.toThrow("redirect:/login");
  });

  it("treats a missing or forbidden space the same", async () => {
    m.getSpace.mockRejectedValueOnce(new ApiError(404, "nf", "missing"));
    await expect(renderFor()).rejects.toThrow("not-found");
    m.getSpace.mockRejectedValueOnce(new ApiError(403, "no", "forbidden"));
    await expect(renderFor()).rejects.toThrow("not-found");
    m.getSpace.mockRejectedValueOnce(new ApiError(500, "x", "kaboom"));
    await expect(renderFor()).rejects.toThrow("kaboom");
  });

  it("opens the home page when the space has one", async () => {
    m.listPages.mockResolvedValue([{ id: "p1", slug: "eng", title: "Engineering", parent_id: null }]);
    await expect(renderFor()).rejects.toThrow(/redirect:\/spaces\/ENG\/pages\//);
  });

  it("shows the workspace with permissions from the space", async () => {
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-restrictions", "true");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-export", "true");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-edit", "true");
  });

  it("denies powers the space does not grant, but trusts a superuser", async () => {
    m.getSpace.mockResolvedValue({ name: "Engineering" });
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-restrictions", "false");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-edit", "false");

    document.body.innerHTML = "";
    m.getCurrentUser.mockResolvedValue(me({ is_superuser: true }));
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-restrictions", "true");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-edit", "true");
  });
});

describe("RecentlyWorkedOnPage", () => {
  it("redirects anonymous visitors", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(RecentlyWorkedOnPage()).rejects.toThrow("redirect:/login");
  });

  it("explains when you have not edited anything", async () => {
    m.listRecentPages.mockResolvedValue([{ id: "1", user_username: "someone-else" }]);
    render(await RecentlyWorkedOnPage());
    expect(screen.getByText("No edits yet")).toBeInTheDocument();
  });

  it("lists only your own edits", async () => {
    m.listRecentPages.mockResolvedValue([
      { id: "1", user_username: "Ann", title: "Mine", slug: "my page", space_key: "ENG", space_name: "Engineering", updated_at: "2026-03-05T12:00:00Z" },
      { id: "2", user_username: "bob", title: "Theirs", slug: "t", space_key: "ENG", space_name: "Engineering", updated_at: "2026-03-05T12:00:00Z" },
    ]);
    render(await RecentlyWorkedOnPage());
    expect(screen.getByRole("link", { name: /Mine/ })).toHaveAttribute("href", "/spaces/ENG/pages/my%20page");
    expect(screen.getByText(/Engineering · Updated Mar 5, 2026/)).toBeInTheDocument();
    expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
    expect(m.listRecentPages).toHaveBeenCalledWith(100);
  });
});

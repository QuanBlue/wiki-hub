import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import type { Me, SidebarPermissions, Space, UserPinnedPageItem } from "@/types/api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function makeUser(role: "admin" | "member"): Me {
  return {
    id: "user-1",
    username: role === "admin" ? "admin" : "member",
    full_name: role === "admin" ? "Administrator" : "Team Member",
    email: `${role}@example.com`,
    avatar_url: null,
    is_active: true,
    is_superuser: role === "admin",
    global_permissions: role === "admin" ? ["system_admin"] : [],
    impersonator: null,
  } as unknown as Me;
}

const sampleSpace: Space = {
  id: "space-1",
  key: "ENG",
  name: "Engineering",
  description: "",
  icon: "",
  font_family: null,
  max_upload_size_mb: null,
  status: "active",
  visibility: "open",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by_username: "admin",
  owners: [],
  is_owner: false,
  member_count: 1,
  group_permission_count: 0,
  direct_user_permission_count: 0,
  is_favorite: true,
  my_role: null,
  my_permissions: [],
};

const samplePinnedPage: UserPinnedPageItem = {
  id: "pin-1",
  pinned_at: "2026-01-01T00:00:00Z",
  space_key: "ENG",
  space_name: "Engineering",
  title: "Architecture Spec",
  slug: "architecture-spec",
};

describe("Sidebar permissions gating", () => {
  it("renders all items when full permissions are given to member", () => {
    const permissions: SidebarPermissions = {
      home: ["admin", "member"],
      spaces: ["admin", "member"],
      favorites: ["admin", "member"],
      pinned: ["admin", "member"],
      settings: ["admin"],
      backups: ["admin"],
    };

    render(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Sidebar
          user={makeUser("member")}
          permissions={permissions}
          favoriteSpaces={[sampleSpace]}
          pinnedPages={[samplePinnedPage]}
        />
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Spaces" })).toBeInTheDocument();
    expect(screen.getByText("Favorite spaces")).toBeInTheDocument();
    expect(screen.getByText("Pinned pages")).toBeInTheDocument();
    expect(screen.getByText("Architecture Spec")).toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("hides home and spaces when member is not granted access", () => {
    const permissions: SidebarPermissions = {
      home: ["admin"],
      spaces: ["admin"],
      favorites: ["admin", "member"],
      pinned: ["admin", "member"],
      settings: ["admin"],
      backups: ["admin"],
    };

    render(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Sidebar
          user={makeUser("member")}
          permissions={permissions}
          favoriteSpaces={[sampleSpace]}
          pinnedPages={[samplePinnedPage]}
        />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Spaces" })).not.toBeInTheDocument();
    expect(screen.getByText("Favorite spaces")).toBeInTheDocument();
    expect(screen.getByText("Pinned pages")).toBeInTheDocument();
  });

  it("hides favorite spaces when permissions.favorites restricts to admin", () => {
    const permissions: SidebarPermissions = {
      home: ["admin", "member"],
      spaces: ["admin", "member"],
      favorites: ["admin"],
      pinned: ["admin", "member"],
      settings: ["admin"],
      backups: ["admin"],
    };

    render(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Sidebar
          user={makeUser("member")}
          permissions={permissions}
          favoriteSpaces={[sampleSpace]}
          pinnedPages={[samplePinnedPage]}
        />
      </SidebarProvider>,
    );

    expect(screen.queryByText("Favorite spaces")).not.toBeInTheDocument();
    expect(screen.getByText("Pinned pages")).toBeInTheDocument();
  });

  it("hides pinned pages when permissions.pinned restricts to admin", () => {
    const permissions: SidebarPermissions = {
      home: ["admin", "member"],
      spaces: ["admin", "member"],
      favorites: ["admin", "member"],
      pinned: ["admin"],
      settings: ["admin"],
      backups: ["admin"],
    };

    render(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Sidebar
          user={makeUser("member")}
          permissions={permissions}
          favoriteSpaces={[sampleSpace]}
          pinnedPages={[samplePinnedPage]}
        />
      </SidebarProvider>,
    );

    expect(screen.getByText("Favorite spaces")).toBeInTheDocument();
    expect(screen.queryByText("Pinned pages")).not.toBeInTheDocument();
    expect(screen.queryByText("Architecture Spec")).not.toBeInTheDocument();
  });

  it("renders administration sections for superuser admin", () => {
    const permissions: SidebarPermissions = {
      home: ["admin"],
      spaces: ["admin"],
      favorites: ["admin"],
      pinned: ["admin"],
      settings: ["admin"],
      backups: ["admin"],
    };

    render(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Sidebar
          user={makeUser("admin")}
          permissions={permissions}
          favoriteSpaces={[sampleSpace]}
          pinnedPages={[samplePinnedPage]}
        />
      </SidebarProvider>,
    );

    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backup" })).toBeInTheDocument();
  });
});

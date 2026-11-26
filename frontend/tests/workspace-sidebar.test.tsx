import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "@/components/pages/workspace/workspace-sidebar";
import type { Space } from "@/types/api";

vi.mock("@/components/pages/create-page-dialog", () => ({
  CreatePageDialog: () => <button type="button">Create page</button>,
}));

vi.mock("@/components/seasonal/seasonal-sidebar-overlay", () => ({
  SeasonalSidebarOverlay: () => null,
}));

const BASE_SPACE: Space = {
  id: 1,
  key: "ENG",
  name: "Engineering",
  description: "",
  icon: null,
  status: "active",
  is_private: false,
  created_by: 1,
  owner_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  my_role: "admin",
  my_permissions: ["view", "edit", "delete", "admin"],
};

function renderSidebar(overrides?: Partial<React.ComponentProps<typeof WorkspaceSidebar>>) {
  const props: React.ComponentProps<typeof WorkspaceSidebar> = {
    space: BASE_SPACE,
    pages: [],
    homeHref: "/spaces/ENG",
    activeSlug: null,
    canEdit: true,
    canAdmin: true,
    canUseTrash: true,
    collapsed: false,
    mobileOpen: false,
    setMobileOpen: vi.fn(),
    dragging: false,
    setDragging: vi.fn(),
    sidebarWidth: 256,
    desktopSidebarWidth: 256,
    showPanel: true,
    favorite: false,
    favoritePending: false,
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
    spaceSidebarScrollRef: createRef<HTMLDivElement>(),
    onOpenImportDialog: vi.fn(),
    onOpenMap: vi.fn(),
    onOpenHealth: vi.fn(),
    onOpenTemplates: vi.fn(),
    onOpenEditSpace: vi.fn(),
    onOpenTrash: vi.fn(),
    ...overrides,
  };

  render(<WorkspaceSidebar {...props} />);

  return props;
}

describe("WorkspaceSidebar footer options menu", () => {
  it("opens the compact menu, shows feature explanations on hover, and triggers actions", async () => {
    const actor = userEvent.setup();
    const props = renderSidebar();

    await actor.click(screen.getByRole("button", { name: "Space options" }));

    const mapItem = screen.getByRole("menuitem", { name: "Page map" });
    const healthItem = screen.getByRole("menuitem", { name: "Health" });
    const templatesItem = screen.getByRole("menuitem", { name: "Templates" });
    const editItem = screen.getByRole("menuitem", { name: "Edit space" });
    const trashItem = screen.getByRole("menuitem", { name: "Trash" });

    expect(mapItem).toBeInTheDocument();
    expect(healthItem).toBeInTheDocument();
    expect(templatesItem).toBeInTheDocument();
    expect(editItem).toBeInTheDocument();
    expect(trashItem).toBeInTheDocument();

    await actor.hover(healthItem);
    expect(
      await screen.findByRole("tooltip", {
        name: "Check for stale pages, broken links, orphans, and duplicates.",
      }),
    ).toBeInTheDocument();

    await actor.click(editItem);
    expect(props.onOpenEditSpace).toHaveBeenCalledTimes(1);
  });

  it("hides admin and trash items when the reader lacks permission", async () => {
    const actor = userEvent.setup();
    renderSidebar({ canAdmin: false, canUseTrash: false });

    await actor.click(screen.getByRole("button", { name: "Space options" }));

    expect(screen.getByRole("menuitem", { name: "Page map" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Health" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Templates" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit space" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Trash" })).toBeNull();
  });
});

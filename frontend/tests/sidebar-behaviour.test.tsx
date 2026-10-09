import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";
import { Sidebar } from "@/components/layout/sidebar";
import type { Me, SidebarPermissions, Space, UserPinnedPageItem } from "@/types/api";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const mail = vi.hoisted(() => ({
  summary: { has_inbox: false, unread_count: 0 } as { has_inbox: boolean; unread_count: number },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/layout/mail-summary-provider", () => ({
  useMailSummary: () => ({ summary: mail.summary }),
}));

const ALL: SidebarPermissions = {
  home: ["admin", "member"],
  spaces: ["admin", "member"],
  favorites: ["admin", "member"],
  pinned: ["admin", "member"],
  settings: ["admin"],
  backups: ["admin"],
};

function makeUser(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    username: "admin",
    full_name: "Admin",
    email: "admin@example.com",
    avatar_url: null,
    is_active: true,
    is_superuser: true,
    global_permissions: ["system_admin"],
    impersonator: null,
    ...overrides,
  } as unknown as Me;
}

function makeSpace(index: number, icon = ""): Space {
  return {
    id: `space-${index}`,
    key: `K${index}`,
    name: `Space ${index}`,
    description: "",
    icon,
    status: "active",
    visibility: "open",
    is_favorite: true,
  } as unknown as Space;
}

function makePin(index: number): UserPinnedPageItem {
  return {
    id: `pin-${index}`,
    pinned_at: "2026-01-01T00:00:00Z",
    space_key: "ENG",
    space_name: "Engineering",
    title: `Pinned ${index}`,
    slug: `pinned ${index}`,
  };
}

function Probe() {
  const s = useSidebar();
  return (
    <div>
      <span data-testid="probe">
        {JSON.stringify({ collapsed: s.collapsed, width: s.sidebarWidth, mobile: s.mobileOpen })}
      </span>
      <button onClick={() => s.setMobileOpen(true)}>open-mobile</button>
      <button onClick={() => s.setCollapsed(true)}>collapse</button>
    </div>
  );
}

function renderSidebar(
  props: Partial<React.ComponentProps<typeof Sidebar>> = {},
  provider: { initialCollapsed?: boolean; initialSidebarWidth?: number } = {},
) {
  return render(
    <SidebarProvider initialCollapsed={false} initialSidebarWidth={240} {...provider}>
      <Probe />
      <Sidebar
        user={makeUser()}
        permissions={ALL}
        favoriteSpaces={[]}
        pinnedPages={[]}
        {...props}
      />
    </SidebarProvider>,
  );
}

const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}");

beforeEach(() => {
  nav.pathname = "/";
  mail.summary = { has_inbox: false, unread_count: 0 };
  window.localStorage.clear();
  delete document.documentElement.dataset.whSidebarCollapsed;
  document.documentElement.style.removeProperty("--wh-preloaded-sidebar-width");
});

describe("Sidebar navigation", () => {
  it("shows the admin section and marks the current page", () => {
    nav.pathname = "/admin/users";
    renderSidebar();

    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    for (const name of ["Groups", "Settings", "Mailboxes", "Storage", "Backup"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("marks Home active only on the exact route", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("limits a narrow admin to the section their permission unlocks", () => {
    renderSidebar({
      user: makeUser({
        is_superuser: false,
        global_permissions: ["manage_users"],
      } as Partial<Me>),
    });
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Groups" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Backup" })).not.toBeInTheDocument();
  });

  it("falls back to default visibility when permissions are missing entirely", () => {
    renderSidebar({
      user: makeUser({ is_superuser: false, global_permissions: [] } as Partial<Me>),
      permissions: {} as SidebarPermissions,
    });
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.getByText("Favorite spaces")).toBeInTheDocument();
  });

  it("shows the inbox with an unread badge, capped at 99+", () => {
    mail.summary = { has_inbox: true, unread_count: 7 };
    const view = renderSidebar();
    expect(screen.getByRole("link", { name: "Requests (7)" })).toHaveTextContent("7");

    view.unmount();
    mail.summary = { has_inbox: true, unread_count: 250 };
    renderSidebar();
    expect(screen.getByRole("link", { name: "Requests (250)" })).toHaveTextContent("99+");
  });

  it("shows the inbox without a badge when everything is read", () => {
    mail.summary = { has_inbox: true, unread_count: 0 };
    renderSidebar();
    const inbox = screen.getByRole("link", { name: "Requests" });
    expect(inbox).not.toHaveTextContent(/\d/);
  });

  it("collapses to icons with titles and a dot for unread mail", () => {
    mail.summary = { has_inbox: true, unread_count: 3 };
    renderSidebar({}, { initialCollapsed: true });
    act(() => {
      window.localStorage.setItem("wikihub:sidebar-collapsed", "true");
      window.dispatchEvent(new Event("wikihub:sidebar-collapsed"));
    });

    const inbox = screen.getByRole("link", { name: "Requests (3)" });
    expect(inbox).toHaveAttribute("title", "Requests (3)");
    expect(inbox).not.toHaveTextContent("Requests");
    expect(screen.queryByText("Favorite spaces")).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage sidebar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resize app sidebar" })).not.toBeInTheDocument();
  });

  it("folds and unfolds each section", async () => {
    const actor = userEvent.setup();
    renderSidebar({ favoriteSpaces: [makeSpace(1)], pinnedPages: [makePin(1)] });

    for (const [title, hidden] of [
      ["Overview", "Home"],
      ["Favorite spaces", "Space 1"],
      ["Pinned pages", "Pinned 1"],
      ["Administration", "Users"],
    ] as const) {
      const toggle = screen.getByRole("button", { name: title });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      await actor.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
      await actor.click(toggle);
      expect(screen.getByText(hidden)).toBeInTheDocument();
    }
  });
});

describe("Sidebar shortcuts", () => {
  it("lists the favourite spaces (with custom icons) and pinned pages", () => {
    nav.pathname = "/spaces/K2/pages/anything";
    renderSidebar({
      favoriteSpaces: [makeSpace(1, "🚀"), makeSpace(2, "📄")],
      pinnedPages: [makePin(1)],
    });

    expect(screen.getByRole("link", { name: /Space 1/ })).toHaveTextContent("🚀");
    expect(screen.getByRole("link", { name: /Space 2/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Pinned 1/ })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/pinned%201",
    );
    expect(screen.getByRole("link", { name: /Pinned 1/ })).not.toHaveAttribute("aria-current");
  });

  it("marks the pinned page that is open", () => {
    nav.pathname = "/spaces/ENG/pages/pinned%201";
    renderSidebar({ pinnedPages: [makePin(1)] });
    expect(screen.getByRole("link", { name: /Pinned 1/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows empty hints when there is nothing to list", () => {
    renderSidebar();
    expect(screen.getByText("No favorite spaces yet.")).toBeInTheDocument();
    expect(screen.getByText("No pinned pages yet.")).toBeInTheDocument();
  });

  it("hides the manage button when neither collection is visible", () => {
    renderSidebar({
      permissions: { ...ALL, favorites: ["admin"], pinned: ["admin"] },
      user: makeUser({ is_superuser: false, global_permissions: [] } as Partial<Me>),
    });
    expect(screen.queryByRole("button", { name: "Manage sidebar" })).not.toBeInTheDocument();
  });

  it("manages the shortcuts in a dialog, with a limit of five", async () => {
    const actor = userEvent.setup();
    const spaces = Array.from({ length: 12 }, (_, i) => makeSpace(i + 1));
    renderSidebar({ favoriteSpaces: spaces, pinnedPages: [makePin(1), makePin(2)] });

    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("12 spaces")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Choose up to 5 shortcuts for the sidebar (5/5)."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Showing 1–10 of 12")).toBeInTheDocument();

    // At the limit, unselected rows cannot be added until one is removed.
    expect(within(dialog).getByRole("button", { name: "Show Space 6 in sidebar" })).toBeDisabled();
    await actor.click(within(dialog).getByRole("button", { name: "Remove Space 1 from sidebar" }));
    const add = within(dialog).getByRole("button", { name: "Show Space 6 in sidebar" });
    expect(add).toBeEnabled();
    await actor.click(add);
    expect(
      within(dialog).getByRole("button", { name: "Remove Space 6 from sidebar" }),
    ).toBeInTheDocument();

    // Paging.
    const previous = within(dialog).getByRole("button", { name: "Previous page" });
    const next = within(dialog).getByRole("button", { name: "Next page" });
    expect(previous).toBeDisabled();
    await actor.click(next);
    expect(within(dialog).getByText("Showing 11–12 of 12")).toBeInTheDocument();
    expect(next).toBeDisabled();
    await actor.click(previous);
    expect(within(dialog).getByText("Showing 1–10 of 12")).toBeInTheDocument();

    // Page size.
    await actor.selectOptions(within(dialog).getByLabelText("Items per page"), "25");
    expect(within(dialog).getByText("Showing 1–12 of 12")).toBeInTheDocument();
  });

  it("switches to pinned pages and toggles them", async () => {
    const actor = userEvent.setup();
    renderSidebar({ favoriteSpaces: [makeSpace(1)], pinnedPages: [makePin(1), makePin(2)] });

    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("tab", { name: /Pinned pages/ }));
    expect(within(dialog).getByText("2 pages")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Remove Pinned 1 from sidebar" }));
    expect(
      within(dialog).getByRole("button", { name: "Show Pinned 1 in sidebar" }),
    ).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Show Pinned 1 in sidebar" }));

    await actor.click(within(dialog).getByRole("tab", { name: /Favorite spaces/ }));
    expect(within(dialog).getByText("1 spaces")).toBeInTheDocument();
  });

  it("opens straight on pinned pages when favourites are hidden", async () => {
    const actor = userEvent.setup();
    renderSidebar({
      permissions: { ...ALL, favorites: [] },
      pinnedPages: Array.from({ length: 11 }, (_, i) => makePin(i + 1)),
    });
    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(dialog).getByText("11 pages")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Next page" }));
    expect(within(dialog).getByText("Showing 11–11 of 11")).toBeInTheDocument();
  });

  it("shows no pager for an empty collection", async () => {
    const actor = userEvent.setup();
    renderSidebar();
    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("follows a shortcut link out of the dialog and closes it with Escape", async () => {
    const actor = userEvent.setup();
    renderSidebar({ favoriteSpaces: [makeSpace(1)], pinnedPages: [makePin(1)] });

    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    let dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("link", { name: /Space 1/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("tab", { name: /Pinned pages/ }));
    await actor.click(within(dialog).getByRole("link", { name: /Pinned 1/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await actor.click(screen.getByRole("button", { name: "Manage sidebar" }));
    await screen.findByRole("dialog");
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Sidebar drawer and resizing", () => {
  it("opens as a drawer on small screens and closes by scrim, Escape or navigation", async () => {
    const actor = userEvent.setup();
    const view = renderSidebar();
    expect(document.querySelector(".fixed.inset-0.z-20")).toBeNull();

    await actor.click(screen.getByText("open-mobile"));
    expect(probe().mobile).toBe(true);
    const scrim = document.querySelector<HTMLElement>(".fixed.inset-0.z-20")!;
    expect(scrim).not.toBeNull();
    await actor.click(scrim);
    expect(probe().mobile).toBe(false);

    await actor.click(screen.getByText("open-mobile"));
    fireEvent.keyDown(window, { key: "a" });
    expect(probe().mobile).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(probe().mobile).toBe(false);

    await actor.click(screen.getByText("open-mobile"));
    await actor.click(screen.getAllByRole("link", { name: "Spaces" })[0]);
    expect(probe().mobile).toBe(false);

    await actor.click(screen.getByText("open-mobile"));
    nav.pathname = "/spaces";
    view.rerender(
      <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
        <Probe />
        <Sidebar user={makeUser()} permissions={ALL} favoriteSpaces={[]} pinnedPages={[]} />
      </SidebarProvider>,
    );
    expect(probe().mobile).toBe(false);
  });

  it("resizes by dragging the handle, collapsing when pulled to the edge", async () => {
    renderSidebar();
    const handle = screen.getByRole("button", { name: "Resize app sidebar" });

    fireEvent.pointerDown(handle);
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent(window, Object.assign(new Event("pointermove"), { clientX: 320 }));
    await waitFor(() => expect(probe().width).toBe(320));
    expect(probe().collapsed).toBe(false);

    fireEvent(window, Object.assign(new Event("pointermove"), { clientX: 10 }));
    await waitFor(() => expect(probe().collapsed).toBe(true));

    fireEvent.pointerUp(window);
    expect(document.body.style.cursor).toBe("");
  });

  it("stops dragging on pointer cancel", () => {
    renderSidebar();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize app sidebar" }));
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(window, new Event("pointercancel"));
    expect(document.body.style.userSelect).toBe("");
  });

  it("keeps the full panel on mobile even when the rail is collapsed", async () => {
    const actor = userEvent.setup();
    renderSidebar();
    await actor.click(screen.getByText("collapse"));
    expect(screen.queryByText("Favorite spaces")).not.toBeInTheDocument();
    await actor.click(screen.getByText("open-mobile"));
    expect(screen.getByText("Favorite spaces")).toBeInTheDocument();
  });
});

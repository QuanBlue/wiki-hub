"use client";

import {
  Database,
  FolderCog,
  HardDrive,
  Home,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Pin,
  SlidersHorizontal,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";
import type { Me, SidebarPermissions, Space, UserPinnedPageItem } from "@/types/api";

interface NavItem {
  permission: keyof SidebarPermissions;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sections that only become reachable in a later phase. */
  disabled?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, permission: "home" },
  { href: "/spaces", label: "Spaces", icon: LayoutGrid, permission: "spaces" },
];

// All administration sections gate on the same "settings" permission - they
// are one cluster only superusers reach (app/admin/layout.tsx enforces the
// real boundary); the sidebar toggle is about showing the whole section, not
// picking sections apart one by one. Backup keeps its own dedicated
// "backups" key since the admin settings screen already offers it separately.
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: User, permission: "settings" },
  {
    href: "/admin/groups",
    label: "Groups",
    icon: Users,
    permission: "settings",
  },
  {
    href: "/admin/spaces",
    label: "Spaces",
    icon: FolderCog,
    permission: "settings",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: SlidersHorizontal,
    permission: "settings",
  },
  {
    href: "/admin/backup",
    label: "Backup",
    icon: Database,
    permission: "backups",
  },
  {
    href: "/admin/storage",
    label: "Storage",
    icon: HardDrive,
    permission: "settings",
  },
];

/** "/" only matches the exact home route; every other item matches its own subtree. */
function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const className = cn(
    // Colour and icon size match the ghost-button toolbar (components/ui/button.tsx):
    // muted by default, full-strength on hover. Weight stays light for an
    // inactive item and only picks up font-medium once selected, so the
    // active page reads as heavier rather than every row looking bold.
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal",
    "transition-[color,background-color] duration-150",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    collapsed && "justify-center px-0",
    active
      ? "bg-surface-selected text-primary font-medium"
      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
    // A disabled item must not pretend to be interactive.
    item.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
  );

  if (item.disabled) {
    return (
      <span
        className={className}
        aria-disabled
        title="Available in a later phase"
      >
        <item.icon className="size-4 shrink-0" />
        {!collapsed && item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={className}
      aria-current={active ? "page" : undefined}
      // When collapsed the label is gone, so the icon needs an accessible name.
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && item.label}
    </Link>
  );
}

function SectionToggle({
  title,
  expanded,
  onToggle,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center rounded-md px-2 py-1 text-left text-[11px] font-semibold tracking-wide uppercase transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      {title}
    </button>
  );
}

/** A titled group of nav items, with the divider/label the top-level group skips. */
function NavSection({
  title,
  items,
  pathname,
  collapsed,
  onNavigate,
  expanded,
  onToggle,
  withDivider = true,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
  expanded: boolean;
  onToggle: () => void;
  withDivider?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <>
      {withDivider ? <div className="border-border my-3 border-t" /> : null}
      {!collapsed ? <SectionToggle title={title} expanded={expanded} onToggle={onToggle} /> : null}
      {expanded ? <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              item={item}
              active={isNavItemActive(item, pathname)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul> : null}
    </>
  );
}

/**
 * The user's own most-opened spaces (server-ranked by a per-user visit
 * counter, not just membership), inline so a frequently used space is one
 * click away. Hidden entirely when the rail is collapsed to icons - a
 * growing name list has nowhere to go there. AppShell supplies the first
 * directory spaces as a fallback for brand-new accounts with no visit history.
 */
function FavoriteSpacesSection({
  spaces,
  collapsed,
  pathname,
  onNavigate,
  expanded,
  onToggle,
}: {
  spaces: Space[];
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (collapsed) return null;

  return (
    <>
      <div className="border-border my-3 border-t" />
      <SectionToggle title="Favorite spaces" expanded={expanded} onToggle={onToggle} />
      {expanded && spaces.length ? <ul className="space-y-0.5">
        {spaces.slice(0, 5).map((space) => {
          const href = `/spaces/${encodeURIComponent(space.key)}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const hasCustomEmoji = Boolean(space.icon && space.icon !== "📄");
          return (
            <li key={space.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  "transition-colors duration-150",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "bg-surface-selected text-primary font-medium"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                )}
              >
                {hasCustomEmoji ? (
                  <span
                    className="flex size-4 shrink-0 items-center justify-center text-xs leading-none"
                    aria-hidden
                  >
                    {space.icon}
                  </span>
                ) : (
                  <Layers className="size-4 shrink-0" aria-hidden />
                )}
                <span className="truncate">{space.name}</span>
              </Link>
            </li>
          );
        })}
      </ul> : expanded ? <p className="text-muted-foreground px-2 py-1.5 text-xs">No favorite spaces yet.</p> : null}
      {expanded && spaces.length > 5 ? <Link
        href="/favorites"
        onClick={onNavigate}
        className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <MoreHorizontal className="size-4 shrink-0" aria-hidden />
        <span>Show all favorite spaces</span>
      </Link> : null}
    </>
  );
}

function PinnedPagesSection({
  pages,
  collapsed,
  pathname,
  onNavigate,
  expanded,
  onToggle,
}: {
  pages: UserPinnedPageItem[];
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (collapsed) return null;
  return (
    <>
      <div className="border-border my-3 border-t" />
      <SectionToggle title="Pinned pages" expanded={expanded} onToggle={onToggle} />
      {expanded && pages.length ? <ul className="space-y-0.5">
        {pages.slice(0, 5).map((page) => {
          const href = `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`;
          const active = pathname === href;
          return (
            <li key={page.id}>
              <Link href={href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none", active ? "bg-surface-selected text-primary font-medium" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected")}>
                <Pin className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{page.title}</span>
              </Link>
            </li>
          );
        })}
      </ul> : expanded ? <p className="text-muted-foreground px-2 py-1.5 text-xs">No pinned pages yet.</p> : null}
    </>
  );
}

export function Sidebar({
  user,
  permissions,
  favoriteSpaces,
  pinnedPages,
}: {
  user: Me;
  permissions: SidebarPermissions;
  favoriteSpaces: Space[];
  pinnedPages: UserPinnedPageItem[];
}) {
  const pathname = usePathname();
  const {
    collapsed,
    setCollapsed,
    sidebarWidth,
    setSidebarWidth,
    mobileOpen,
    setMobileOpen,
  } = useSidebar();
  const [dragging, setDragging] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    favorites: true,
    pinned: true,
    administration: true,
  });
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const role =
    user.is_superuser || user.global_permissions.includes("system_admin")
      ? "admin"
      : "member";
  const overviewItems = OVERVIEW_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );
  const adminItems = ADMIN_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );
  const showFavoriteSpaces = permissions.spaces.includes(role);

  // Navigating on a phone must close the drawer, otherwise it covers the page
  // the user just asked for.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Escape closes the drawer, matching what every overlay on the web does.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, setMobileOpen]);

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const nextWidth = Math.max(0, event.clientX);
      if (nextWidth <= 56) {
        setCollapsed(true);
        return;
      }
      setSidebarWidth(nextWidth);
      setCollapsed(false);
    };
    const stopDragging = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, setCollapsed, setSidebarWidth]);

  // The drawer is only collapsed-styled on desktop; on mobile it is always the
  // full-width panel, otherwise the overlay would show bare icons.
  const railCollapsed = collapsed && !mobileOpen;
  const onNavigate = () => setMobileOpen(false);

  return (
    <>
      {/* Scrim: closes the drawer and blocks clicks on the content beneath. */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <nav
        id="wikihub-sidebar"
        data-sidebar-kind="app"
        aria-label="Primary"
        className={cn(
          "wh-scroll top-topbar border-border bg-surface-sunken fixed inset-y-0 left-0 z-20",
          "overflow-x-hidden overflow-y-auto border-r px-2 py-3",
          !dragging &&
            "transition-[width,transform] duration-200 motion-reduce:transition-none",
          railCollapsed ? "w-14" : "w-sidebar md:w-(--app-sidebar-width)",
          // Off-canvas on mobile unless opened; always on-canvas from md up.
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        style={
          {
            "--app-sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <NavSection
          title="Overview"
          items={overviewItems}
          pathname={pathname}
          collapsed={railCollapsed}
          onNavigate={onNavigate}
          withDivider={false}
          expanded={expandedSections.overview}
          onToggle={() => toggleSection("overview")}
        />

        {showFavoriteSpaces ? (
          <FavoriteSpacesSection
            spaces={favoriteSpaces}
            collapsed={railCollapsed}
            pathname={pathname}
            onNavigate={onNavigate}
            expanded={expandedSections.favorites}
            onToggle={() => toggleSection("favorites")}
          />
        ) : null}

        <PinnedPagesSection
          pages={pinnedPages}
          collapsed={railCollapsed}
          pathname={pathname}
          onNavigate={onNavigate}
          expanded={expandedSections.pinned}
          onToggle={() => toggleSection("pinned")}
        />

        <NavSection
          title="Administration"
          items={adminItems}
          pathname={pathname}
          collapsed={railCollapsed}
          onNavigate={onNavigate}
          expanded={expandedSections.administration}
          onToggle={() => toggleSection("administration")}
        />

        {!railCollapsed ? (
          <button
            type="button"
            aria-label="Resize app sidebar"
            title="Drag to resize sidebar"
            onPointerDown={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            className="group focus-visible:ring-ring absolute top-0 right-0 hidden h-full w-3 translate-x-1/2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none md:block"
          >
            <span
              className={cn(
                "bg-border-strong absolute top-0 right-1/2 h-full w-px opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
                dragging && "opacity-100",
              )}
            />
          </button>
        ) : null}
      </nav>
    </>
  );
}

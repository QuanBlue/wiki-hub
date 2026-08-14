"use client";

import {
  Database,
  FolderCog,
  HardDrive,
  Home,
  LayoutGrid,
  MoreHorizontal,
  SlidersHorizontal,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";
import type { Me, SidebarPermissions, Space } from "@/types/api";

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
  { href: "/admin/users", label: "Users", icon: Users, permission: "settings" },
  {
    href: "/admin/groups",
    label: "Groups",
    icon: UsersRound,
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

/** A titled group of nav items, with the divider/label the top-level group skips. */
function NavSection({
  title,
  items,
  pathname,
  collapsed,
  onNavigate,
  withDivider = true,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
  withDivider?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <>
      {withDivider ? <div className="border-border my-3 border-t" /> : null}
      {!collapsed ? (
        <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
          {title}
        </p>
      ) : null}
      <ul className="space-y-0.5">
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
      </ul>
    </>
  );
}

/**
 * Up to `MY_SPACES_LIMIT` spaces the user is a member of, inline so a
 * frequent space is one click away; the rest stay a single "View all" link
 * rather than growing the rail without bound. Hidden entirely when the rail
 * is collapsed to icons - a growing name list has nowhere to go there.
 */
function MySpacesSection({
  spaces,
  moreCount,
  collapsed,
  pathname,
  onNavigate,
}: {
  spaces: Space[];
  moreCount: number;
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  if (collapsed || spaces.length === 0) return null;

  return (
    <>
      <div className="border-border my-3 border-t" />
      <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
        My spaces
      </p>
      <ul className="space-y-0.5">
        {spaces.map((space) => {
          const href = `/spaces/${encodeURIComponent(space.key)}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
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
                <span
                  className="bg-primary-subtle flex size-5 shrink-0 items-center justify-center rounded text-[11px]"
                  aria-hidden
                >
                  {space.icon || "📄"}
                </span>
                <span className="truncate">{space.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {moreCount > 0 ? (
        <Link
          href="/spaces"
          onClick={onNavigate}
          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center"
            aria-hidden
          >
            <MoreHorizontal className="size-4" />
          </span>
          View all spaces
        </Link>
      ) : null}
    </>
  );
}

export function Sidebar({
  user,
  permissions,
  mySpaces,
  moreSpacesCount,
}: {
  user: Me;
  permissions: SidebarPermissions;
  mySpaces: Space[];
  moreSpacesCount: number;
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
  const role = user.is_superuser || user.global_permissions.includes("system_admin") ? "admin" : "member";
  const overviewItems = OVERVIEW_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );
  const adminItems = ADMIN_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );
  const showMySpaces = permissions.spaces.includes(role);

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
        />

        {showMySpaces ? (
          <MySpacesSection
            spaces={mySpaces}
            moreCount={moreSpacesCount}
            collapsed={railCollapsed}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ) : null}

        <NavSection
          title="Administration"
          items={adminItems}
          pathname={pathname}
          collapsed={railCollapsed}
          onNavigate={onNavigate}
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

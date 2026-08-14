"use client";

import {
  Clock,
  DatabaseBackup,
  Home,
  LayoutGrid,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";
import type { Me, SidebarPermissions } from "@/types/api";

interface NavItem {
  permission: keyof SidebarPermissions;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sections that only become reachable in a later phase. */
  disabled?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, permission: "home" },
  { href: "/spaces", label: "Spaces", icon: LayoutGrid, permission: "spaces" },
  { href: "/recent", label: "Recent", icon: Clock, permission: "recent" },
];

const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings",
  },
  {
    href: "/admin/backup",
    label: "Backups",
    icon: DatabaseBackup,
    permission: "backups",
  },
];

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
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
    "transition-[color,background-color] duration-150",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    collapsed && "justify-center px-0",
    active
      ? "bg-surface-selected text-primary font-medium"
      : "text-foreground hover:bg-surface-hover active:bg-surface-selected",
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

export function Sidebar({
  user,
  permissions,
}: {
  user: Me;
  permissions: SidebarPermissions;
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
  const role = user.is_superuser ? "admin" : "member";
  const primaryItems = PRIMARY_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );
  const adminItems = ADMIN_NAV.filter((item) =>
    permissions[item.permission].includes(role),
  );

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
        <ul className="space-y-0.5">
          {primaryItems.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={pathname === item.href}
                collapsed={railCollapsed}
                onNavigate={() => setMobileOpen(false)}
              />
            </li>
          ))}
        </ul>

        {adminItems.length > 0 ? (
          <div className="border-border my-3 border-t" />
        ) : null}

        {!railCollapsed && adminItems.length > 0 ? (
          <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            Administration
          </p>
        ) : null}
        <ul className="space-y-0.5">
          {adminItems.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={pathname.startsWith(item.href)}
                collapsed={railCollapsed}
                onNavigate={() => setMobileOpen(false)}
              />
            </li>
          ))}
        </ul>
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

"use client";

import {
  Clock,
  Home,
  LayoutGrid,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sections that only become reachable in a later phase. */
  disabled?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/spaces", label: "Spaces", icon: LayoutGrid },
  { href: "/recent", label: "Recent", icon: Clock },
  { href: "/favorites", label: "Favorites", icon: Star },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Settings", icon: Settings },
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

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();

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
        aria-label="Primary"
        className={cn(
          "wh-scroll top-topbar border-border bg-surface-sunken fixed inset-y-0 left-0 z-20",
          "overflow-y-auto border-r px-2 py-3",
          "transition-[width,transform] duration-200 motion-reduce:transition-none",
          railCollapsed ? "w-14" : "w-sidebar",
          // Off-canvas on mobile unless opened; always on-canvas from md up.
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
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

        <div className="border-border my-3 border-t" />

        {!railCollapsed ? (
          <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            Administration
          </p>
        ) : null}
        <ul className="space-y-0.5">
          {ADMIN_NAV.map((item) => (
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
      </nav>
    </>
  );
}

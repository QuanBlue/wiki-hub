"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  FolderCog,
  HardDrive,
  Home,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  PanelLeft,
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/context";
import {
  SIDEBAR_SHORTCUT_LIMIT,
  useSidebarShortcuts,
} from "@/lib/sidebar-shortcuts";
import { cn } from "@/lib/utils";
import type {
  Me,
  SidebarPermissions,
  Space,
  UserPinnedPageItem,
} from "@/types/api";

interface NavItem {
  permission: keyof SidebarPermissions;
  href: string;
  /** Dictionary key under `nav.*`, resolved at render time. */
  labelKey: string;
  icon: LucideIcon;
  /** Sections that only become reachable in a later phase. */
  disabled?: boolean;
  /**
   * A narrower global permission that also unlocks this one item, on top of
   * whatever `permission`'s role-based check already allows - e.g. Users
   * stays visible to a `manage_users` holder even when the "settings"
   * section is configured as admin-only (see `app/admin/layout.tsx` for why
   * `manage_users`/`manage_groups` each unlock exactly one section, and why
   * `create_space` unlocks none of them).
   */
  extraGlobalPermission?: "manage_users" | "manage_groups";
}

const OVERVIEW_NAV: NavItem[] = [
  { href: "/", labelKey: "nav.home", icon: Home, permission: "home" },
  { href: "/spaces", labelKey: "nav.spaces", icon: LayoutGrid, permission: "spaces" },
];

const COLLECTION_PAGE_SIZES = [5, 10, 25, 50] as const;

// All administration sections gate on the same "settings" permission - they
// are one cluster only superusers reach (app/admin/layout.tsx enforces the
// real boundary); the sidebar toggle is about showing the whole section, not
// picking sections apart one by one. Backup keeps its own dedicated
// "backups" key since the admin settings screen already offers it separately.
const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/users",
    labelKey: "nav.users",
    icon: User,
    permission: "settings",
    extraGlobalPermission: "manage_users",
  },
  {
    href: "/admin/groups",
    labelKey: "nav.groups",
    icon: Users,
    permission: "settings",
    extraGlobalPermission: "manage_groups",
  },
  {
    href: "/admin/spaces",
    labelKey: "nav.spaces",
    icon: FolderCog,
    permission: "settings",
  },
  {
    href: "/admin/settings",
    labelKey: "nav.settings",
    icon: SlidersHorizontal,
    permission: "settings",
  },
  {
    href: "/admin/backup",
    labelKey: "nav.backup",
    icon: Database,
    permission: "backups",
  },
  {
    href: "/admin/storage",
    labelKey: "nav.storage",
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
  const { t } = useTranslation();
  const label = t(item.labelKey);
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
        title={t("nav.availableLater")}
      >
        <item.icon className="size-4 shrink-0" />
        {!collapsed && label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={className}
      aria-current={active ? "page" : undefined}
      // When collapsed the label is gone, so the icon needs an accessible name.
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onNavigate}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && label}
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
      {!collapsed ? (
        <SectionToggle title={title} expanded={expanded} onToggle={onToggle} />
      ) : null}
      {expanded ? (
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
      ) : null}
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
  const { t } = useTranslation();
  if (collapsed) return null;

  return (
    <>
      <div className="border-border my-3 border-t" />
      <SectionToggle
        title={t("nav.favoriteSpaces")}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && spaces.length ? (
        <ul className="space-y-0.5">
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
        </ul>
      ) : expanded ? (
        <p className="text-muted-foreground px-2 py-1.5 text-xs">
          {t("nav.noFavoriteSpaces")}
        </p>
      ) : null}
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
  const { t } = useTranslation();
  if (collapsed) return null;
  return (
    <>
      <div className="border-border my-3 border-t" />
      <SectionToggle
        title={t("nav.pinnedPages")}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && pages.length ? (
        <ul className="space-y-0.5">
          {pages.slice(0, 5).map((page) => {
            const href = `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`;
            const active = pathname === href;
            return (
              <li key={page.id}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "bg-surface-selected text-primary font-medium"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                  )}
                >
                  <Pin className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{page.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : expanded ? (
        <p className="text-muted-foreground px-2 py-1.5 text-xs">
          {t("nav.noPinnedPages")}
        </p>
      ) : null}
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
  const { t } = useTranslation();
  const {
    collapsed,
    setCollapsed,
    sidebarWidth,
    setSidebarWidth,
    mobileOpen,
    setMobileOpen,
  } = useSidebar();
  const [dragging, setDragging] = useState(false);
  const [collectionPanel, setCollectionPanel] = useState<
    "favorites" | "pinned" | null
  >(null);
  const [collectionPage, setCollectionPage] = useState(0);
  const [collectionPageSize, setCollectionPageSize] =
    useState<(typeof COLLECTION_PAGE_SIZES)[number]>(10);
  const { sidebarFavoriteIds, sidebarPinnedIds, toggleSidebarShortcut } =
    useSidebarShortcuts(favoriteSpaces, pinnedPages);
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    favorites: true,
    pinned: true,
    administration: true,
  });
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };
  const role =
    user.is_superuser || user.global_permissions.includes("system_admin")
      ? "admin"
      : "member";
  const overviewItems = OVERVIEW_NAV.filter((item) =>
    (permissions[item.permission] ?? ["admin", "member"]).includes(role),
  );
  const adminItems = ADMIN_NAV.filter(
    (item) =>
      (permissions[item.permission] ?? ["admin"]).includes(role) ||
      (item.extraGlobalPermission &&
        user.global_permissions.includes(item.extraGlobalPermission)),
  );
  const showFavoriteSpaces = (
    permissions.favorites ??
    permissions.spaces ?? ["admin", "member"]
  ).includes(role);
  const showPinnedPages = (
    permissions.pinned ?? ["admin", "member"]
  ).includes(role);

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
  const collectionCount =
    collectionPanel === "favorites"
      ? favoriteSpaces.length
      : pinnedPages.length;
  const collectionPageCount = Math.max(
    1,
    Math.ceil(collectionCount / collectionPageSize),
  );
  const collectionStart = collectionPage * collectionPageSize;
  const sidebarFavoriteSpaces = favoriteSpaces.filter((space) =>
    sidebarFavoriteIds.includes(space.id),
  );
  const sidebarPinnedPages = pinnedPages.filter((page) =>
    sidebarPinnedIds.includes(page.id),
  );

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
        aria-label={t("nav.primary")}
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
          title={t("nav.overview")}
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
            spaces={sidebarFavoriteSpaces}
            collapsed={railCollapsed}
            pathname={pathname}
            onNavigate={onNavigate}
            expanded={expandedSections.favorites}
            onToggle={() => toggleSection("favorites")}
          />
        ) : null}

        {showPinnedPages ? (
          <PinnedPagesSection
            pages={sidebarPinnedPages}
            collapsed={railCollapsed}
            pathname={pathname}
            onNavigate={onNavigate}
            expanded={expandedSections.pinned}
            onToggle={() => toggleSection("pinned")}
          />
        ) : null}

        <NavSection
          title={t("nav.administration")}
          items={adminItems}
          pathname={pathname}
          collapsed={railCollapsed}
          onNavigate={onNavigate}
          expanded={expandedSections.administration}
          onToggle={() => toggleSection("administration")}
        />

        {!railCollapsed && (showFavoriteSpaces || showPinnedPages) ? (
          <>
            <div className="border-border my-3 border-t" />
            <button
              type="button"
              onClick={() => {
                setCollectionPage(0);
                setCollectionPanel(showFavoriteSpaces ? "favorites" : "pinned");
              }}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <MoreHorizontal className="size-4 shrink-0" aria-hidden />
              <span>{t("nav.manageSidebar")}</span>
            </button>
          </>
        ) : null}

        {!railCollapsed ? (
          <button
            type="button"
            aria-label={t("nav.resizeSidebar")}
            title={t("nav.dragToResize")}
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

      <Dialog
        open={collectionPanel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCollectionPanel(null);
            setCollectionPage(0);
          }
        }}
      >
        {collectionPanel ? (
          <DialogContent
            title={t("nav.manageSidebarTitle")}
            description={t("nav.manageSidebarDescription")}
            className="flex h-[28rem] max-w-md flex-col overflow-hidden"
          >
            <div className="flex min-h-0 flex-1 flex-col">
              {showFavoriteSpaces ? (
                <div
                  role="tablist"
                  aria-label={t("nav.sidebarShortcutType")}
                  className="border-border mb-3 flex gap-1 border-b"
                >
                  {(["favorites", "pinned"] as const).map((panel) => {
                    const selected = collectionPanel === panel;
                    return (
                      <button
                        key={panel}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => {
                          setCollectionPanel(panel);
                          setCollectionPage(0);
                        }}
                        className={cn(
                          "focus-visible:ring-ring -mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          selected
                            ? "border-primary text-primary font-medium"
                            : "text-muted-foreground border-transparent hover:text-foreground",
                        )}
                      >
                        {panel === "favorites" ? (
                          <Layers className="size-3.5 shrink-0" aria-hidden />
                        ) : (
                          <Pin className="size-3.5 shrink-0" aria-hidden />
                        )}
                        {panel === "favorites"
                          ? t("nav.favoriteSpaces")
                          : t("nav.pinnedPages")}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="bg-primary-subtle text-primary mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
                {collectionPanel === "favorites"
                  ? t("nav.spacesCount", { count: collectionCount })
                  : t("nav.pagesCount", { count: collectionCount })}
              </div>
              <p className="text-muted-foreground mb-2 text-xs">
                {t("nav.chooseUpTo", {
                  limit: SIDEBAR_SHORTCUT_LIMIT,
                  current:
                    collectionPanel === "favorites"
                      ? sidebarFavoriteIds.length
                      : sidebarPinnedIds.length,
                })}
              </p>
              <ul className="wh-scroll -mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
                {collectionPanel === "favorites"
                  ? favoriteSpaces
                      .slice(
                        collectionStart,
                        collectionStart + collectionPageSize,
                      )
                      .map((space) => (
                        <li key={space.id} className="flex items-center gap-1">
                          <Link
                            href={`/spaces/${encodeURIComponent(space.key)}`}
                            onClick={() => {
                              setCollectionPanel(null);
                              onNavigate();
                            }}
                            className="text-muted-foreground hover:bg-surface-sunken hover:text-foreground focus-visible:ring-ring flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <span className="bg-primary-subtle text-primary flex size-6 shrink-0 items-center justify-center rounded-md">
                              <Layers className="size-3.5" aria-hidden />
                            </span>
                            <span className="truncate">{space.name}</span>
                          </Link>
                          <Button
                            type="button"
                            variant={
                              sidebarFavoriteIds.includes(space.id)
                                ? "subtle"
                                : "ghost"
                            }
                            size="icon"
                            aria-label={
                              sidebarFavoriteIds.includes(space.id)
                                ? t("nav.removeFromSidebar", { name: space.name })
                                : t("nav.showInSidebar", { name: space.name })
                            }
                            title={
                              sidebarFavoriteIds.includes(space.id)
                                ? t("nav.shownInSidebar")
                                : t("nav.showInSidebarShort")
                            }
                            disabled={
                              !sidebarFavoriteIds.includes(space.id) &&
                              sidebarFavoriteIds.length >=
                                SIDEBAR_SHORTCUT_LIMIT
                            }
                            onClick={() =>
                              toggleSidebarShortcut("favorites", space.id)
                            }
                          >
                            {sidebarFavoriteIds.includes(space.id) ? (
                              <Check aria-hidden />
                            ) : (
                              <PanelLeft aria-hidden />
                            )}
                          </Button>
                        </li>
                      ))
                  : pinnedPages
                      .slice(
                        collectionStart,
                        collectionStart + collectionPageSize,
                      )
                      .map((page) => (
                        <li key={page.id} className="flex items-center gap-1">
                          <Link
                            href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                            onClick={() => {
                              setCollectionPanel(null);
                              onNavigate();
                            }}
                            className="text-muted-foreground hover:bg-surface-sunken hover:text-foreground focus-visible:ring-ring flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <span className="bg-primary-subtle text-primary flex size-6 shrink-0 items-center justify-center rounded-md">
                              <Pin className="size-3.5" aria-hidden />
                            </span>
                            <span className="truncate">{page.title}</span>
                          </Link>
                          <Button
                            type="button"
                            variant={
                              sidebarPinnedIds.includes(page.id)
                                ? "subtle"
                                : "ghost"
                            }
                            size="icon"
                            aria-label={
                              sidebarPinnedIds.includes(page.id)
                                ? t("nav.removeFromSidebar", { name: page.title })
                                : t("nav.showInSidebar", { name: page.title })
                            }
                            title={
                              sidebarPinnedIds.includes(page.id)
                                ? t("nav.shownInSidebar")
                                : t("nav.showInSidebarShort")
                            }
                            disabled={
                              !sidebarPinnedIds.includes(page.id) &&
                              sidebarPinnedIds.length >= SIDEBAR_SHORTCUT_LIMIT
                            }
                            onClick={() =>
                              toggleSidebarShortcut("pinned", page.id)
                            }
                          >
                            {sidebarPinnedIds.includes(page.id) ? (
                              <Check aria-hidden />
                            ) : (
                              <PanelLeft aria-hidden />
                            )}
                          </Button>
                        </li>
                      ))}
              </ul>
              {collectionCount > 0 ? (
                <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <p>
                      {t("common.showingRange", {
                        from: collectionStart + 1,
                        to: Math.min(
                          collectionStart + collectionPageSize,
                          collectionCount,
                        ),
                        total: collectionCount,
                      })}
                    </p>
                    <label className="sr-only" htmlFor="collection-page-size">
                      {t("common.itemsPerPage")}
                    </label>
                    <select
                      id="collection-page-size"
                      value={collectionPageSize}
                      onChange={(event) => {
                        setCollectionPageSize(
                          Number(
                            event.target.value,
                          ) as (typeof COLLECTION_PAGE_SIZES)[number],
                        );
                        setCollectionPage(0);
                      }}
                      className="border-border bg-surface text-foreground hover:border-border-strong focus-visible:ring-ring h-7 rounded-md border px-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {COLLECTION_PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {t("common.perPage", { size })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      aria-label={t("common.previousPage")}
                      title={t("common.previousPage")}
                      disabled={collectionPage === 0}
                      onClick={() => setCollectionPage((page) => page - 1)}
                    >
                      <ChevronLeft aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      aria-label={t("common.nextPage")}
                      title={t("common.nextPage")}
                      disabled={collectionPage >= collectionPageCount - 1}
                      onClick={() => setCollectionPage((page) => page + 1)}
                    >
                      <ChevronRight aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

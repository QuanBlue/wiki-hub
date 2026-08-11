"use client";

import {
  Eye,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  Tag,
  ThumbsUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useState } from "react";
import { toast } from "sonner";

import { useSidebar } from "@/components/layout/sidebar-context";
import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Space, SpaceMember, WikiPage } from "@/types/api";
import type { CSSProperties } from "react";

const SPACE_SIDEBAR_WIDTH_KEY = "wikihub:space-sidebar-width";
const SPACE_SIDEBAR_WIDTH_COOKIE = "wikihub_space_sidebar_width";
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = 320;

const spaceSidebarWidthStore = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(SPACE_SIDEBAR_WIDTH_KEY, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(SPACE_SIDEBAR_WIDTH_KEY, onChange);
    };
  },
  getSnapshot(): number {
    try {
      const stored = window.localStorage.getItem(SPACE_SIDEBAR_WIDTH_KEY);
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isFinite(value)) {
          return clampWidth(value);
        }
      }
    } catch {
      // Ignore blocked storage; resizing still works for the current render.
    }
    const preloaded = Number.parseFloat(
      document.documentElement.style.getPropertyValue(
        "--wh-preloaded-space-sidebar-width",
      ),
    );
    if (Number.isFinite(preloaded)) return clampWidth(preloaded);
    return DEFAULT_SIDEBAR_WIDTH;
  },
  getServerSnapshot(): number {
    return DEFAULT_SIDEBAR_WIDTH;
  },
  set(value: number): void {
    const width = clampWidth(value);
    try {
      window.localStorage.setItem(SPACE_SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // The preference simply does not persist.
    }
    document.cookie = `${SPACE_SIDEBAR_WIDTH_COOKIE}=${width}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.style.setProperty(
      "--wh-preloaded-space-sidebar-width",
      `${width}px`,
    );
    window.dispatchEvent(new Event(SPACE_SIDEBAR_WIDTH_KEY));
  },
};

function clampWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function SpaceAvatar({ space }: { space: Space }) {
  return (
    <span
      aria-hidden
      className="bg-primary-subtle text-primary flex size-12 shrink-0 items-center justify-center rounded-md text-xl font-semibold"
    >
      {(space.icon || space.name.slice(0, 1)).toUpperCase()}
    </span>
  );
}

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring flex min-h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-surface-selected text-primary font-medium"
          : "text-foreground hover:bg-surface-hover active:bg-surface-selected",
      )}
    >
      {children}
    </Link>
  );
}

export function SpaceWorkspace({
  space,
  pages,
  members,
  currentPage,
  initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
}: {
  space: Space;
  pages: WikiPage[];
  members: SpaceMember[];
  currentPage?: WikiPage | null;
  initialSidebarWidth?: number;
}) {
  const router = useRouter();
  const { collapsed, setCollapsed, mobileOpen } = useSidebar();
  const sidebarWidth = useSyncExternalStore(
    spaceSidebarWidthStore.subscribe,
    spaceSidebarWidthStore.getSnapshot,
    () => {
      if (typeof document !== "undefined") {
        const preloaded = Number.parseFloat(
          document.documentElement.style.getPropertyValue(
            "--wh-preloaded-space-sidebar-width",
          ),
        );
        if (Number.isFinite(preloaded)) return clampWidth(preloaded);
      }
      return initialSidebarWidth;
    },
  );
  const [dragging, setDragging] = useState(false);
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [favoritePending, setFavoritePending] = useState(false);

  const title = currentPage?.title ?? space.name;
  const body = currentPage?.content || space.description;
  const activeSlug = currentPage?.slug ?? null;
  const author = currentPage?.created_by_username ?? space.created_by_username;
  const updatedBy =
    currentPage?.updated_by_username ?? space.created_by_username;
  const updatedAt = currentPage?.updated_at ?? space.updated_at;

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    setFavoritePending(true);
    try {
      const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/favorite`;
      if (next) {
        await api.put<void>(path);
      } else {
        await api.delete<void>(path);
      }
      router.refresh();
    } catch {
      setFavorite(!next);
      toast.error("Could not update favourites.");
    } finally {
      setFavoritePending(false);
    }
  }

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      spaceSidebarWidthStore.set(event.clientX);
      setCollapsed(false);
    };
    const onPointerUp = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging, setCollapsed]);

  const sidebarVisible = mobileOpen || !collapsed;
  const desktopSidebarWidth = collapsed ? 0 : sidebarWidth;

  return (
    <div className="bg-background min-h-[calc(100vh-var(--wh-topbar-height))] md:flex">
      <aside
        id="wikihub-sidebar"
        data-sidebar-kind="space"
        className={cn(
          "relative shrink-0",
          !dragging &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          "md:top-topbar md:sticky md:h-[calc(100vh-var(--wh-topbar-height))]",
          sidebarVisible ? "block" : "hidden md:block",
          "md:w-(--space-sidebar-width)",
        )}
        style={
          {
            "--space-sidebar-width": `${desktopSidebarWidth}px`,
            "--space-sidebar-panel-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        {!collapsed ? (
          <div className="border-border bg-surface-sunken h-full border-r md:w-(--space-sidebar-panel-width) md:overflow-y-auto">
            <div className="flex min-h-full flex-col px-5 py-4">
              <div className="flex items-start gap-3">
                <SpaceAvatar space={space} />
                <div className="min-w-0 flex-1 pt-1">
                  <Link
                    href={`/spaces/${encodeURIComponent(space.key)}`}
                    className="hover:text-primary focus-visible:ring-ring block truncate rounded text-sm font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {space.name}
                  </Link>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {space.key}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleFavorite()}
                  disabled={favoritePending}
                  aria-label={
                    favorite ? "Remove from favourites" : "Add to favourites"
                  }
                  aria-pressed={favorite}
                  title={
                    favorite ? "Remove from favourites" : "Add to favourites"
                  }
                  className={cn(
                    "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    "disabled:pointer-events-none disabled:opacity-50",
                    favorite
                      ? "text-amber-500"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Star className={cn("size-4", favorite && "fill-current")} />
                </button>
              </div>

              <div className="mt-6 flex items-center justify-between gap-2 px-2">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  Page Tree
                </p>
                {space.status === "active" ? (
                  <CreatePageDialog
                    spaceKey={space.key}
                    triggerLabel="New"
                    triggerVariant="ghost"
                    triggerSize="sm"
                  />
                ) : null}
              </div>

              <nav aria-label={`${space.name} page tree`} className="mt-2">
                <ul className="space-y-0.5">
                  <li>
                    <SidebarLink
                      href={`/spaces/${encodeURIComponent(space.key)}`}
                      active={!activeSlug}
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">Overview</span>
                    </SidebarLink>
                  </li>
                  {pages.map((page, index) => (
                    <li key={page.id}>
                      <SidebarLink
                        href={pageHref(space.key, page.slug)}
                        active={activeSlug === page.slug}
                      >
                        <span className="text-muted-foreground w-4 shrink-0 text-center text-xs">
                          {index + 1}.
                        </span>
                        <span className="truncate">{page.title}</span>
                      </SidebarLink>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>
        ) : null}
        {!collapsed ? (
          <button
            type="button"
            aria-label="Resize space sidebar"
            title="Drag to resize sidebar"
            onPointerDown={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            className={cn(
              "group absolute top-0 right-0 hidden h-full w-3 translate-x-1/2 cursor-col-resize md:block",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <span
              className={cn(
                "bg-border-strong absolute top-0 right-1/2 h-full w-px opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
                dragging && "opacity-100",
              )}
            />
          </button>
        ) : null}
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-6 py-5 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Breadcrumb" className="text-sm">
              <Link
                href={`/spaces/${encodeURIComponent(space.key)}`}
                className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Pages
              </Link>
              {currentPage ? (
                <>
                  <span className="text-muted-foreground mx-2">/</span>
                  <span className="text-muted-foreground">
                    {currentPage.title}
                  </span>
                </>
              ) : null}
            </nav>

            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" disabled>
                <Pencil />
                Edit
              </Button>
              <Button variant="ghost" size="sm" disabled>
                <MessageCircle />
                View inline comments
              </Button>
              <Button variant="ghost" size="sm">
                <Star />
                Save for later
              </Button>
              <Button variant="ghost" size="sm">
                <Eye />
                Watch
              </Button>
              <Button variant="ghost" size="sm">
                <Share2 />
                Share
              </Button>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </div>
          </div>

          <article className="mt-4 max-w-[var(--wh-content-max)]">
            <h1 className="text-foreground text-3xl font-semibold tracking-normal">
              {title}
            </h1>
            <p className="text-muted-foreground mt-2 text-xs">
              Created by {author ?? "unknown"}
              {updatedBy ? `, last modified by ${updatedBy}` : ""}
              {updatedAt ? ` on ${formatDate(updatedAt)}` : ""}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <ThumbsUp className="size-4" />
                Like
              </button>
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                No labels
                <Tag className="size-3.5" />
              </span>
            </div>

            <div className="mt-8 min-h-64">
              {body ? (
                <div className="text-foreground text-sm leading-7 whitespace-pre-wrap">
                  {body}
                </div>
              ) : (
                <div className="border-border bg-surface-sunken rounded-lg border border-dashed p-6">
                  <p className="font-medium">No content yet</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Create a page from the page tree to start documenting this
                    space.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-10 flex items-start gap-3">
              <span
                aria-hidden
                className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              >
                {author?.slice(0, 1).toUpperCase() ?? "W"}
              </span>
              <div className="border-border bg-surface text-muted-foreground min-h-16 flex-1 rounded-md border px-3 py-2 text-sm">
                Write a comment...
              </div>
            </div>
          </article>

          {members.length > 0 ? (
            <div className="border-border mt-12 border-t pt-4">
              <p className="text-muted-foreground text-xs">
                {members.length} {members.length === 1 ? "member" : "members"}{" "}
                in this space
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

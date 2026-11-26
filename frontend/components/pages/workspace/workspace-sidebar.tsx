"use client";

import {
  ChevronsUpDown,
  FileUp,
  HeartPulse,
  LayoutTemplate,
  MoreHorizontal,
  Network,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, RefObject } from "react";
import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { SeasonalSidebarOverlay } from "@/components/seasonal/seasonal-sidebar-overlay";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Space, WikiPage } from "@/types/api";
import { PageTree } from "./page-tree";
import { SpaceAvatar } from "./workspace-primitives";

export type WorkspaceSidebarProps = {
  space: Space;
  pages: WikiPage[];
  homeHref: string;
  activeSlug: string | null;
  canEdit: boolean;
  canAdmin: boolean;
  canUseTrash: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  sidebarWidth: number;
  desktopSidebarWidth: number;
  showPanel: boolean;
  favorite: boolean;
  favoritePending: boolean;
  toggleFavorite: () => Promise<void>;
  spaceSidebarScrollRef: RefObject<HTMLDivElement | null>;
  onOpenImportDialog: () => void;
  onOpenMap: () => void;
  onOpenHealth: () => void;
  onOpenTemplates?: () => void;
  onOpenEditSpace: () => void;
  onOpenTrash: () => void;
};

export function WorkspaceSidebar({
  space,
  pages,
  homeHref,
  activeSlug,
  canEdit,
  canAdmin,
  canUseTrash,
  collapsed,
  mobileOpen,
  setMobileOpen,
  dragging,
  setDragging,
  sidebarWidth,
  desktopSidebarWidth,
  showPanel,
  favorite,
  favoritePending,
  toggleFavorite,
  spaceSidebarScrollRef,
  onOpenImportDialog,
  onOpenMap,
  onOpenHealth,
  onOpenTemplates,
  onOpenEditSpace,
  onOpenTrash,
}: WorkspaceSidebarProps) {
  const { t } = useTranslation();
  const favouriteLabel = favorite
    ? t("spaces.removeFavourite")
    : t("spaces.addFavourite");

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("topbar.collapseSidebar")}
          onClick={() => setMobileOpen(false)}
          className="top-topbar fixed inset-x-0 bottom-0 z-30 cursor-default bg-black/40 md:hidden"
        />
      ) : null}
      <aside
        id="wikihub-sidebar"
        data-sidebar-kind="space"
        className={cn(
          "shrink-0 overflow-x-hidden",
          !dragging &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          // A phone: a drawer sliding in from the left, under the top bar.
          "max-md:top-topbar max-md:fixed max-md:bottom-0 max-md:left-0 max-md:z-40 max-md:w-[min(20rem,85vw)] max-md:shadow-xl",
          "max-md:transition-[transform,visibility] max-md:duration-200 motion-reduce:max-md:transition-none",
          mobileOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full",
          "md:top-[calc(var(--wh-topbar-height)+var(--wh-banner-height,0px))] md:sticky md:h-[calc(100vh-var(--wh-topbar-height)-var(--wh-banner-height,0px))]",
          "md:w-(--space-sidebar-width)",
        )}
        style={
          {
            "--space-sidebar-width": `${desktopSidebarWidth}px`,
            "--space-sidebar-panel-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        {showPanel ? (
          <div className="border-border bg-surface-sunken relative flex h-full w-full max-w-full flex-col overflow-hidden border-r md:w-(--space-sidebar-panel-width)">
            <SeasonalSidebarOverlay />
            <div className="flex min-w-0 shrink-0 flex-col px-5 py-4">
              <div className="flex items-start gap-3">
                <SpaceAvatar space={space} />
                <div className="min-w-0 flex-1 pt-1">
                  <Link
                    href={homeHref}
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
                  aria-label={favouriteLabel}
                  aria-pressed={favorite}
                  title={favouriteLabel}
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
                  {t("workspace.pageTreeHeading")}
                </p>
                {space.status === "active" && canEdit ? (
                  <div className="flex items-center gap-0.5">
                    <CreatePageDialog
                      spaceKey={space.key}
                      triggerLabel=""
                      triggerVariant="ghost"
                      triggerSize="icon"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("workspace.importPagesTitle")}
                      aria-label={t("workspace.importPagesTitle")}
                      onClick={onOpenImportDialog}
                    >
                      <FileUp />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            <div
              ref={spaceSidebarScrollRef}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-4"
            >
              <nav aria-label={t("workspace.pageTreeAria", { name: space.name })} className="mt-2">
                <ul className="space-y-0.5">
                  <PageTree
                    pages={pages}
                    spaceKey={space.key}
                    activeSlug={activeSlug}
                  />
                </ul>
              </nav>
            </div>

            {/* Sidebar Footer: space options menu grouping the page map for
                every reader, Trash for anyone who may delete pages here, and
                content health, templates, and Edit space for its Owner or
                Admin. */}
            <div className="border-border shrink-0 border-t p-3">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("workspace.spaceOptions")}
                    className={cn(
                      "text-muted-foreground hover:bg-surface-selected hover:text-foreground active:bg-surface-selected",
                      "data-[state=open]:bg-surface-selected data-[state=open]:text-foreground",
                      "focus-visible:ring-ring flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-medium",
                      "transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    )}
                  >
                    <MoreHorizontal className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{t("workspace.spaceOptions")}</span>
                    <ChevronsUpDown
                      className="ml-auto size-3.5 shrink-0 opacity-60"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  sideOffset={18}
                  className="min-w-44 text-sm font-medium"
                >
                  <TooltipProvider delayDuration={200} skipDelayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem onSelect={onOpenMap}>
                          <Network aria-hidden />
                          {t("graph.mapLink")}
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        {t("workspace.spaceOptionMapHint")}
                      </TooltipContent>
                    </Tooltip>
                    {canAdmin ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem onSelect={onOpenHealth}>
                            <HeartPulse aria-hidden />
                            {t("health.link")}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {t("workspace.spaceOptionHealthHint")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    {canAdmin && onOpenTemplates ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem onSelect={onOpenTemplates}>
                            <LayoutTemplate aria-hidden />
                            {t("templates.link")}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {t("workspace.spaceOptionTemplatesHint")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    {canAdmin || canUseTrash ? <DropdownMenuSeparator /> : null}
                    {canAdmin ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem onSelect={onOpenEditSpace}>
                            <Pencil aria-hidden />
                            {t("workspace.editSpace")}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {t("workspace.spaceOptionEditHint")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    {canUseTrash ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem onSelect={onOpenTrash}>
                            <Trash2 aria-hidden />
                            {t("trash.link")}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {t("workspace.spaceOptionTrashHint")}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </TooltipProvider>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : null}
        {!collapsed ? (
          <button
            type="button"
            aria-label={t("workspace.resizeSpaceSidebar")}
            title={t("nav.dragToResize")}
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
    </>
  );
}

"use client";

import { Check, Eye, Layers, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PageWatchRead, Space, SpaceWatchRead, WikiPage } from "@/types/api";

interface WatchButtonProps {
  space: Space;
  page?: WikiPage | null;
  onPageWatchChange?: (watching: boolean, includeDescendants: boolean) => void;
  onSpaceWatchChange?: (watching: boolean) => void;
}

export function WatchButton({
  space,
  page,
  onPageWatchChange,
  onSpaceWatchChange,
}: WatchButtonProps) {
  const { t } = useTranslation();

  const [pageWatched, setPageWatched] = useState(Boolean(page?.is_watched));
  const [watchBranch, setWatchBranch] = useState(Boolean(page?.watch_descendants));
  const [spaceWatched, setSpaceWatched] = useState(Boolean(space.is_watched));
  const [pending, setPending] = useState(false);

  const isAnyWatching = pageWatched || spaceWatched;

  async function togglePageWatch(includeDescendants: boolean) {
    if (!page) return;
    setPending(true);

    // If currently watching with this exact setting, turn off. Otherwise turn on / switch mode.
    const isCurrentlyActive = pageWatched && watchBranch === includeDescendants;
    const nextWatching = !isCurrentlyActive;
    const nextDescendants = nextWatching ? includeDescendants : false;

    try {
      const res = await api.put<PageWatchRead>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(
          page.slug,
        )}/watch`,
        {
          watching: nextWatching,
          include_descendants: nextDescendants,
        },
      );
      setPageWatched(res.watching);
      setWatchBranch(res.include_descendants);
      onPageWatchChange?.(res.watching, res.include_descendants);
      toast.success(t("workspace.watchUpdated"));
    } catch {
      toast.error(t("workspace.watchError"));
    } finally {
      setPending(false);
    }
  }

  async function toggleSpaceWatch() {
    setPending(true);
    const nextWatching = !spaceWatched;

    try {
      const res = await api.put<SpaceWatchRead>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/watch`,
        {
          watching: nextWatching,
        },
      );
      setSpaceWatched(res.watching);
      onSpaceWatchChange?.(res.watching);
      toast.success(t("workspace.watchUpdated"));
    } catch {
      toast.error(t("workspace.watchError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-pressed={isAnyWatching}
          className={cn(
            "gap-1.5 transition-colors",
            isAnyWatching && "text-primary font-medium hover:text-primary",
          )}
          title={isAnyWatching ? t("workspace.watchingTooltip") : t("workspace.watchTooltip")}
        >
          <Eye
            className={cn(
              "size-4 transition-colors",
              isAnyWatching
                ? "text-primary [&>circle]:fill-primary"
                : "text-muted-foreground",
            )}
          />
          <span className="hidden sm:inline">
            {isAnyWatching ? t("workspace.watching") : t("workspace.watch")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5 text-sm">
        <DropdownMenuLabel className="text-muted-foreground px-2 py-1 text-xs font-semibold uppercase tracking-wider">
          {t("workspace.watch")}
        </DropdownMenuLabel>

        {page ? (
          <>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void togglePageWatch(false);
              }}
              className="hover:bg-accent flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
            >
              <Eye className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium leading-none">{t("workspace.watchPage")}</p>
                  {pageWatched && !watchBranch ? (
                    <Check className="text-primary size-4 shrink-0" />
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-[11px] leading-tight">
                  {t("workspace.watchPageHint")}
                </p>
              </div>
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void togglePageWatch(true);
              }}
              className="hover:bg-accent flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
            >
              <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium leading-none">{t("workspace.watchBranch")}</p>
                  {pageWatched && watchBranch ? (
                    <Check className="text-primary size-4 shrink-0" />
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-[11px] leading-tight">
                  {t("workspace.watchBranchHint")}
                </p>
              </div>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="my-1" />
          </>
        ) : null}

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void toggleSpaceWatch();
          }}
          className="hover:bg-accent flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2"
        >
          <LayoutGrid className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium leading-none">{t("workspace.watchSpace")}</p>
              {spaceWatched ? <Check className="text-primary size-4 shrink-0" /> : null}
            </div>
            <p className="text-muted-foreground mt-1 text-[11px] leading-tight">
              {t("workspace.watchSpaceHint", { space: space.name })}
            </p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

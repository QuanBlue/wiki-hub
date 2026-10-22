"use client";

import { ArrowLeft, Clock, FileText, Loader2, RotateCcw, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { markdownToHtml } from "@/lib/markdown-html";
import { formatRelative } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type {
  PageRestoreResult,
  Space,
  TrashedPage,
  TrashedPageDetail,
  TrashList,
} from "@/types/api";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A page this close to being removed for good is called out. */
const URGENT_DAYS = 3;
/** With more pages than this, a filter box appears above the list. */
const FILTER_FROM = 6;

/** Whole days left before a page leaves the Trash for good (0 means today). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS));
}

/** How long a page has left, in words. */
function useLeftLabel() {
  const { t } = useTranslation();
  return (iso: string) => {
    const left = daysUntil(iso);
    return left === 0
      ? t("trash.purgeToday")
      : left === 1
        ? t("trash.purgeInOne")
        : t("trash.purgeIn", { days: left });
  };
}

/**
 * A deleted page, read-only, over the Trash: to see what it was before deciding to restore it
 * or remove it for good.
 */
function TrashedPagePreview({
  base,
  item,
  canPurge,
  busy,
  onClose,
  onRestore,
  onPurge,
}: {
  base: string;
  item: TrashedPage | null;
  canPurge: boolean;
  busy: boolean;
  onClose: () => void;
  onRestore: (item: TrashedPage) => void;
  onPurge: (item: TrashedPage) => void;
}) {
  const { t, locale } = useTranslation();
  const leftLabel = useLeftLabel();
  const [attempt, setAttempt] = useState(0);
  // The page with the id it was read for: switching pages never shows the last one's text.
  const [loaded, setLoaded] = useState<{
    key: string;
    detail: TrashedPageDetail | null;
  } | null>(null);
  const id = item?.id ?? null;
  const key = id ? `${id}:${attempt}` : null;

  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .get<TrashedPageDetail>(`${base}/${encodeURIComponent(id)}`)
      .then((detail) => {
        if (live) setLoaded({ key: `${id}:${attempt}`, detail });
      })
      .catch(() => {
        if (live) setLoaded({ key: `${id}:${attempt}`, detail: null });
      });
    return () => {
      live = false;
    };
  }, [id, attempt, base]);

  const current = loaded && loaded.key === key ? loaded : null;
  const detail = current?.detail ?? null;
  const failed = current !== null && detail === null;
  const who = item?.deleted_by_full_name || item?.deleted_by_username;

  return (
    <Dialog open={item !== null} onOpenChange={(next) => !next && onClose()}>
      {item ? (
        <DialogContent
          className="max-w-3xl"
          title={item.title}
          description={[
            t("trash.previewing"),
            who ? t("trash.deletedBy", { name: who }) : null,
            formatRelative(item.deleted_at, locale),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <div className="space-y-3">
            <div className="border-border bg-surface max-h-[55vh] min-h-40 overflow-y-auto rounded-xl border px-5 py-4">
              {failed ? (
                <div className="py-8 text-center" role="alert">
                  <p className="text-sm font-medium">{t("trash.previewError")}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3"
                    onClick={() => setAttempt((n) => n + 1)}
                  >
                    {t("trash.retry")}
                  </Button>
                </div>
              ) : detail === null ? (
                <div className="space-y-2.5" aria-hidden>
                  {["w-2/3", "w-full", "w-5/6", "w-1/2"].map((width) => (
                    <span
                      key={width}
                      className={cn("bg-surface-sunken block h-3 animate-pulse rounded", width)}
                    />
                  ))}
                  <span className="sr-only">{t("trash.loading")}</span>
                </div>
              ) : detail.content.trim() === "" ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("trash.previewEmpty")}
                </p>
              ) : (
                <RichTextContent
                  content={
                    detail.content_format === "markdown"
                      ? markdownToHtml(detail.content)
                      : detail.content
                  }
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                {t("trash.previewHint")} {leftLabel(item.purge_at)}.
              </p>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  <ArrowLeft />
                  {t("trash.previewBack")}
                </Button>
                {canPurge ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
                    disabled={busy}
                    onClick={() => onPurge(item)}
                  >
                    <Trash2 />
                    {t("trash.purge")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRestore(item)}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  {busy ? t("trash.restoring") : t("trash.restore")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/**
 * A space's Trash, as a dialog over the space: pages deleted from it that can still be
 * restored. Opened from the space sidebar, or by ":trash" in the search box.
 */
export function SpaceTrashDialog({
  space,
  open,
  onOpenChange,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  // The list, with the load it came from: opening the dialog again fetches afresh, and
  // until it arrives there is nothing to show but the loading line.
  const [loaded, setLoaded] = useState<{ attempt: number; trash: TrashList | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedPage | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const leftLabel = useLeftLabel();
  const base = `/api/v1/spaces/${encodeURIComponent(space.key)}/trash`;
  const spaceHref = `/spaces/${encodeURIComponent(space.key)}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    api
      .get<TrashList>(base)
      .then((data) => {
        if (live) setLoaded({ attempt, trash: data });
      })
      .catch(() => {
        if (live) setLoaded({ attempt, trash: null });
      });
    return () => {
      live = false;
    };
  }, [open, base, attempt]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const failed = current !== null && current.trash === null;
  const trash = current?.trash ?? null;

  const drop = (id: string) =>
    setLoaded((value) =>
      value && value.trash
        ? { ...value, trash: { ...value.trash, items: value.trash.items.filter((i) => i.id !== id) } }
        : value,
    );

  async function restore(item: TrashedPage) {
    setBusyId(item.id);
    try {
      const restored = await api.post<PageRestoreResult>(
        `${base}/${encodeURIComponent(item.id)}/restore`,
      );
      drop(item.id);
      const href = `${spaceHref}/pages/${encodeURIComponent(restored.slug)}`;
      toast.success(
        t(restored.restored_to_parent ? "trash.restored" : "trash.restoredToTop", {
          title: restored.title,
        }),
        {
          action: {
            label: t("trash.open"),
            onClick: () => {
              onOpenChange(false);
              router.push(href);
            },
          },
        },
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("trash.restoreError"));
    } finally {
      setBusyId(null);
    }
  }

  async function purge() {
    if (!purgeTarget) return;
    setPending(true);
    try {
      await api.delete<void>(`${base}/${encodeURIComponent(purgeTarget.id)}`);
      drop(purgeTarget.id);
      toast.success(t("trash.purged", { title: purgeTarget.title }));
      setPurgeTarget(null);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("trash.purgeError"));
    } finally {
      setPending(false);
    }
  }

  async function emptyTrash() {
    setPending(true);
    try {
      await api.delete<void>(base);
      setLoaded((value) =>
        value && value.trash ? { ...value, trash: { ...value.trash, items: [] } } : value,
      );
      toast.success(t("trash.emptied"));
      setEmptyOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("trash.emptyError"));
    } finally {
      setPending(false);
    }
  }

  const days = trash?.retention_days ?? 30;
  const items = trash?.items ?? [];
  // Gone from the list (restored, or removed for good): nothing left to preview.
  const previewItem = items.find((entry) => entry.id === previewId) ?? null;
  const query = filter.trim().toLowerCase();
  const shown = query
    ? items.filter((item) => item.title.toLowerCase().includes(query))
    : items;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setFilter("");
          onOpenChange(next);
        }}
      >
        <DialogContent
          className="max-w-2xl"
          title={
            <span className="flex items-center gap-2">
              <span className="bg-surface-sunken text-muted-foreground border-border grid size-7 place-items-center rounded-md border">
                <Trash2 className="size-4" aria-hidden />
              </span>
              {t("trash.title")}
            </span>
          }
          titleAddon={
            trash && items.length > 0 ? (
              <Badge variant="neutral" className="font-mono text-[11px]">
                {items.length}
              </Badge>
            ) : null
          }
          description={t("trash.description", { space: space.name, days })}
        >
          {failed ? (
            <div className="border-border rounded-xl border p-6 text-center" role="alert">
              <p className="text-sm font-medium">{t("trash.loadError")}</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("trash.retry")}
              </Button>
            </div>
          ) : trash === null ? (
            <ul className="border-border divide-border divide-y rounded-xl border" aria-hidden>
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center gap-3 px-4 py-3">
                  <span className="bg-surface-sunken size-9 shrink-0 animate-pulse rounded-lg" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="bg-surface-sunken block h-3 w-1/2 animate-pulse rounded" />
                    <span className="bg-surface-sunken block h-2.5 w-3/4 animate-pulse rounded" />
                  </span>
                </li>
              ))}
              <span className="sr-only">{t("trash.loading")}</span>
            </ul>
          ) : items.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed px-6 py-12 text-center">
              <span className="bg-surface-sunken text-muted-foreground mx-auto grid size-12 place-items-center rounded-full">
                <Trash2 className="size-6" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium">{t("trash.emptyTitle")}</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-5">
                {t("trash.emptyHint", { days })}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.length >= FILTER_FROM ? (
                <div className="relative">
                  <Search
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("trash.filter")}
                    aria-label={t("trash.filter")}
                    className="pl-9"
                  />
                </div>
              ) : null}

              {shown.length === 0 ? (
                <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
                  {t("trash.noMatch", { query: filter.trim() })}
                </p>
              ) : (
                <ul className="border-border divide-border max-h-[50vh] divide-y overflow-y-auto rounded-xl border">
                  {shown.map((item) => {
                    const left = daysUntil(item.purge_at);
                    const busy = busyId === item.id;
                    const urgent = left <= URGENT_DAYS;
                    const who = item.deleted_by_full_name || item.deleted_by_username;
                    return (
                      <li
                        key={item.id}
                        className="hover:bg-surface-hover flex flex-col gap-2 px-3 py-2 transition-colors duration-150 sm:flex-row sm:items-center"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewId(item.id)}
                          title={t("trash.preview")}
                          className="focus-visible:ring-ring -m-1 flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg p-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <span className="bg-surface-sunken text-muted-foreground border-border grid size-8 shrink-0 place-items-center rounded-md border">
                            <FileText className="size-4" aria-hidden />
                          </span>
                          <span className="block min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-foreground min-w-0 truncate text-sm font-medium">
                                {item.title}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium",
                                  urgent
                                    ? "bg-warning-bg text-warning"
                                    : "bg-surface-sunken text-muted-foreground",
                                )}
                              >
                                <Clock className="size-3" aria-hidden />
                                {leftLabel(item.purge_at)}
                              </span>
                            </span>
                            <span
                              className="text-muted-foreground block truncate text-xs"
                              title={formatDate(item.deleted_at, locale)}
                            >
                              {[
                                who ? t("trash.deletedBy", { name: who }) : null,
                                formatRelative(item.deleted_at, locale),
                                item.parent_title
                                  ? t("trash.wasUnder", { parent: item.parent_title })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5 sm:pl-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void restore(item)}
                          >
                            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            {busy ? t("trash.restoring") : t("trash.restore")}
                          </Button>
                          {trash.can_purge ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("trash.purge")}
                              title={t("trash.purge")}
                              className="text-muted-foreground hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85 size-7"
                              disabled={busy}
                              onClick={() => setPurgeTarget(item)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-muted-foreground text-xs">
                  {trash.can_purge
                    ? t(items.length === 1 ? "trash.countOne" : "trash.count", {
                        count: items.length,
                      })
                    : t("trash.adminOnlyHint")}
                </p>
                {trash.can_purge ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
                    onClick={() => setEmptyOpen(true)}
                  >
                    <Trash2 />
                    {t("trash.emptyTrash")}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TrashedPagePreview
        base={base}
        item={previewItem}
        canPurge={trash?.can_purge ?? false}
        busy={previewItem !== null && busyId === previewItem.id}
        onClose={() => setPreviewId(null)}
        onRestore={(entry) => void restore(entry)}
        onPurge={setPurgeTarget}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPurgeTarget(null);
        }}
        title={t("trash.purgeTitle")}
        description={t("trash.purgeDescription", { title: purgeTarget?.title ?? "" })}
        confirmLabel={t("trash.purge")}
        destructive
        pending={pending}
        onConfirm={() => void purge()}
      />
      <ConfirmDialog
        open={emptyOpen}
        onOpenChange={setEmptyOpen}
        title={t("trash.emptyTrashTitle")}
        description={t("trash.emptyTrashDescription", { count: items.length })}
        confirmLabel={t("trash.emptyTrash")}
        destructive
        pending={pending}
        onConfirm={() => void emptyTrash()}
      />
    </>
  );
}

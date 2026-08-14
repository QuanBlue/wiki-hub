"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Clock,
  Columns,
  Eye,
  GitCompare,
  Loader2,
  RotateCcw,
  Rows,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getPageRevision,
  getRevisionDiff,
  listPageRevisions,
  restorePageRevision,
} from "@/lib/revisions";
import { cn } from "@/lib/utils";
import type { PageRevisionDiff, PageRevisionItem } from "@/types/api";

type ViewMode = "inline" | "split" | "preview";

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function PageHistoryModal({
  open,
  onOpenChange,
  spaceKey,
  slug,
  pageTitle,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceKey: string;
  slug: string;
  pageTitle: string;
  onRestored?: () => void;
}) {
  const [revisions, setRevisions] = useState<PageRevisionItem[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);

  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);

  const [diffData, setDiffData] = useState<PageRevisionDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [previewRevision, setPreviewRevision] = useState<PageRevisionItem | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("inline");
  const [restoring, setRestoring] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);

  // Fetch all revisions when modal opens
  const fetchRevisions = useCallback(async () => {
    if (!spaceKey || !slug) return;
    setLoadingRevisions(true);
    try {
      const data = await listPageRevisions(spaceKey, slug);
      setRevisions(data);
      if (data.length > 0) {
        const latest = data[0].version;
        const previous = data.length > 1 ? data[1].version : latest;
        setToVersion(latest);
        setFromVersion(previous);
      }
    } catch {
      toast.error("Could not load revision history.");
    } finally {
      setLoadingRevisions(false);
    }
  }, [spaceKey, slug]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load revisions when the modal opens
      void fetchRevisions();
    } else {
      setRevisions([]);
      setDiffData(null);
      setPreviewRevision(null);
      setShowConfirmRestore(false);
    }
  }, [open, fetchRevisions]);

  // Fetch diff data when selected versions change
  useEffect(() => {
    if (!open || fromVersion === null || toVersion === null) return;

    if (viewMode === "preview") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- show the preview loading state before the request resolves
      setLoadingPreview(true);
      getPageRevision(spaceKey, slug, toVersion)
        .then((rev) => setPreviewRevision(rev))
        .catch(() => toast.error("Could not load version preview."))
        .finally(() => setLoadingPreview(false));
      return;
    }

    setLoadingDiff(true);
    getRevisionDiff(spaceKey, slug, fromVersion, toVersion)
      .then((data) => setDiffData(data))
      .catch(() => toast.error("Could not calculate revision diff."))
      .finally(() => setLoadingDiff(false));
  }, [open, spaceKey, slug, fromVersion, toVersion, viewMode]);

  // Restore page handler
  const handleRestore = async () => {
    if (toVersion === null) return;
    setRestoring(true);
    try {
      await restorePageRevision(spaceKey, slug, toVersion);
      toast.success(`Page restored to version ${toVersion}.`);
      setShowConfirmRestore(false);
      onOpenChange(false);
      onRestored?.();
    } catch {
      toast.error(`Could not restore page to version ${toVersion}.`);
    } finally {
      setRestoring(false);
    }
  };

  const selectedToRev = useMemo(
    () => revisions.find((r) => r.version === toVersion),
    [revisions, toVersion],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-xs",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-[5vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-6xl",
            "-translate-x-1/2 rounded-xl border shadow-2xl outline-none",
            "flex max-h-[90vh] flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header Bar */}
          <div className="border-border flex items-center justify-between border-b px-5 py-3.5 bg-surface-sunken">
            <div className="flex items-center gap-3">
              <div className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-lg">
                <Clock className="size-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-foreground text-base">Revision History</h2>
                  <Badge variant="subtle" className="font-mono text-xs">
                    {revisions.length} {revisions.length === 1 ? "version" : "versions"}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs truncate max-w-md">
                  {pageTitle}
                </p>
              </div>
            </div>

            {/* View Mode Controls */}
            <div className="flex items-center gap-2">
              <div className="border-border bg-surface flex items-center rounded-lg border p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("inline")}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    viewMode === "inline"
                      ? "bg-primary-subtle text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Columns className="size-3.5" />
                  <span>Inline Diff</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("split")}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    viewMode === "split"
                      ? "bg-primary-subtle text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Rows className="size-3.5" />
                  <span>Split View</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    viewMode === "preview"
                      ? "bg-primary-subtle text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Eye className="size-3.5" />
                  <span>Live Render</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 hover:bg-surface-hover cursor-pointer"
                aria-label="Close revision modal"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Body Content (Split into Left Timeline and Right Diff Container) */}
          <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
            {/* Left Revision Timeline Sidebar */}
            <div className="w-80 shrink-0 overflow-y-auto bg-surface-sunken p-3 space-y-2">
              <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold uppercase tracking-wider">
                Versions
              </div>

              {loadingRevisions ? (
                <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin text-primary" />
                  Loading history...
                </div>
              ) : revisions.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No revisions found.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {revisions.map((rev) => {
                    const isTo = rev.version === toVersion;
                    const isFrom = rev.version === fromVersion;
                    const isSelected = isTo || isFrom;

                    return (
                      <li key={rev.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (toVersion !== rev.version) {
                              setFromVersion(toVersion);
                              setToVersion(rev.version);
                            }
                          }}
                          className={cn(
                            "w-full cursor-pointer rounded-lg p-3 text-left transition-colors border",
                            isSelected
                              ? "bg-surface border-primary/50 shadow-xs"
                              : "bg-surface/50 border-transparent hover:bg-surface hover:border-border",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={isTo ? "default" : "subtle"}
                                className="font-mono text-xs"
                              >
                                v{rev.version}
                              </Badge>
                              {rev.version === revisions[0].version ? (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                  CURRENT
                                </span>
                              ) : null}
                            </div>
                            <span className="text-muted-foreground text-[11px]">
                              {formatDate(rev.created_at)}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <div className="bg-primary-subtle text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase">
                              {rev.created_by_full_name
                                ? rev.created_by_full_name.charAt(0)
                                : <User className="size-3" />}
                            </div>
                            <span className="font-medium text-xs text-foreground truncate">
                              {rev.created_by_full_name || rev.created_by_username || "System"}
                            </span>
                          </div>

                          {rev.change_summary ? (
                            <p className="text-muted-foreground mt-1.5 text-[11px] truncate italic">
                              &ldquo;{rev.change_summary}&rdquo;
                            </p>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Right Diff Review Main Canvas */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
              {/* Diff Header Bar */}
              <div className="border-border flex items-center justify-between border-b px-5 py-2.5 bg-surface/50 text-xs">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <GitCompare className="size-4 text-primary" />
                  <span>
                    Comparing <strong className="text-foreground font-semibold">v{fromVersion}</strong> to <strong className="text-foreground font-semibold">v{toVersion}</strong>
                  </span>
                  {diffData ? (
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-emerald-600 dark:text-emerald-400">+{diffData.added_count}</span>
                      <span className="text-rose-600 dark:text-rose-400">-{diffData.deleted_count}</span>
                    </div>
                  ) : null}
                </div>

                {selectedToRev && selectedToRev.version !== revisions[0]?.version ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowConfirmRestore(true)}
                    disabled={restoring}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore to v{toVersion}
                  </Button>
                ) : null}
              </div>

              {/* Main Diff Display Panel */}
              <div className="min-h-0 flex-1 overflow-y-auto p-5 font-mono text-xs leading-relaxed">
                {loadingDiff || loadingPreview ? (
                  <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
                    <Loader2 className="mr-2 size-5 animate-spin text-primary" />
                    Calculating differences...
                  </div>
                ) : viewMode === "preview" ? (
                  previewRevision ? (
                    <div className="font-sans space-y-4 max-w-4xl mx-auto py-2">
                      <div className="border-border bg-surface-sunken rounded-lg border p-4">
                        <h1 className="text-2xl font-bold text-foreground">{previewRevision.title}</h1>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Previewing version {previewRevision.version} saved on {formatDate(previewRevision.created_at)}
                        </p>
                      </div>
                      <div
                        className="prose prose-slate dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: previewRevision.content }}
                      />
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">Select a version to preview.</div>
                  )
                ) : viewMode === "split" && diffData ? (
                  <div className="grid grid-cols-2 gap-4 h-full">
                    {/* Left: Version From */}
                    <div className="border-border bg-surface-sunken overflow-y-auto rounded-lg border p-3">
                      <div className="text-muted-foreground mb-2 border-b border-border pb-1 font-sans font-semibold text-xs">
                        v{diffData.from_version}: {diffData.from_title}
                      </div>
                      <div className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                        {diffData.chunks
                          .filter((c) => c.operation !== "add")
                          .map((c, i) => (
                            <div
                              key={i}
                              className={cn(
                                c.operation === "delete" && "bg-rose-500/15 text-rose-700 dark:text-rose-300 px-1 rounded-xs line-through",
                              )}
                            >
                              {c.text}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Right: Version To */}
                    <div className="border-border bg-surface-sunken overflow-y-auto rounded-lg border p-3">
                      <div className="text-muted-foreground mb-2 border-b border-border pb-1 font-sans font-semibold text-xs">
                        v{diffData.to_version}: {diffData.to_title}
                      </div>
                      <div className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                        {diffData.chunks
                          .filter((c) => c.operation !== "delete")
                          .map((c, i) => (
                            <div
                              key={i}
                              className={cn(
                                c.operation === "add" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1 rounded-xs font-semibold",
                              )}
                            >
                              {c.text}
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                ) : diffData ? (
                  /* Inline View */
                  <div className="space-y-3 max-w-4xl mx-auto">
                    {diffData.title_changed ? (
                      <div className="border-warning/30 bg-warning-bg text-warning rounded-lg border p-3 font-sans text-xs">
                        <strong>Title changed:</strong> &ldquo;{diffData.from_title}&rdquo; → &ldquo;<strong className="text-foreground">{diffData.to_title}</strong>&rdquo;
                      </div>
                    ) : null}

                    <div className="border-border bg-surface-sunken overflow-hidden rounded-lg border">
                      {diffData.chunks.map((chunk, index) => (
                        <div
                          key={index}
                          className={cn(
                            "px-4 py-1.5 whitespace-pre-wrap border-l-3 transition-colors",
                            chunk.operation === "add"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500 font-medium"
                              : chunk.operation === "delete"
                              ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500 line-through opacity-80"
                              : "border-transparent text-muted-foreground",
                          )}
                        >
                          <span className="select-none font-mono text-muted-foreground/60 mr-3">
                            {chunk.operation === "add" ? "+" : chunk.operation === "delete" ? "-" : " "}
                          </span>
                          {chunk.text}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">Select revisions to calculate diff.</div>
                )}
              </div>
            </div>
          </div>

          {/* Confirmation Dialog for Restoration */}
          {showConfirmRestore ? (
            <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
              <div className="border-border bg-surface w-full max-w-md rounded-xl border p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="bg-warning-bg text-warning flex size-10 items-center justify-center rounded-full">
                    <RotateCcw className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-base">Restore Version {toVersion}?</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      This will restore the page title and content to version {toVersion}. A new version will be created to preserve full history.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={restoring}
                    onClick={() => setShowConfirmRestore(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={restoring}
                    onClick={handleRestore}
                  >
                    {restoring ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Confirm Restore
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

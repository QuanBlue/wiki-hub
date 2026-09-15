"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CircleMinus,
  CirclePlus,
  Clock,
  GitCompare,
  Loader2,
  RotateCcw,
  User,
  X,
} from "lucide-react";
import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import {
  linkifyPlainTextUrls,
  normalizeConfluenceCodeMacros,
  readerClassName,
} from "@/components/pages/rich-text-editor";
import {
  getRevisionDiff,
  listPageRevisions,
  restorePageRevision,
} from "@/lib/revisions";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  PageRevisionDiff,
  PageRevisionDiffLine,
  PageRevisionDiffSegment,
  PageRevisionItem,
} from "@/types/api";

function RevisionAuthor({
  username,
  fullName,
}: {
  username: string | null;
  fullName: string | null;
}) {
  const { t } = useTranslation();
  const label = fullName || username || t("history.systemAuthor");
  if (!username || username === "system") return <>{label}</>;
  return <UserProfileTrigger username={username} fullName={fullName} />;
}

function DiffLine({
  line,
  side,
}: {
  line: PageRevisionDiffLine;
  side: "old" | "new";
}) {
  const segments = side === "old" ? line.old_segments : line.new_segments;
  const lineNumber = side === "old" ? line.old_line_number : line.new_line_number;
  const text = side === "old" ? line.old_text : line.new_text;
  return (
    <div className={cn("grid grid-cols-[2.5rem_minmax(0,1fr)] whitespace-pre-wrap px-2 py-0.5", side === "old" ? "bg-danger-bg" : "bg-success-bg")}>
      <span className="select-none pr-2 text-right text-muted-foreground/60">{lineNumber ?? ""}</span>
      <span>
        {segments.map((segment: PageRevisionDiffSegment, index: number) => (
          <span key={`${segment.operation}-${index}`} className={cn(segment.operation === "add" && "bg-success-bg text-success", segment.operation === "delete" && "bg-danger-bg text-danger line-through")}>
            {segment.text}
          </span>
        ))}
        {segments.length === 0 ? text : null}
      </span>
    </div>
  );
}

function attachmentKey(link: Element): string | null {
  const href = link.getAttribute("href") ?? "";
  const filename = link.getAttribute("data-attachment") ?? "";
  if (!filename && !/\/api\/v1\/attachments\/[a-f0-9-]{36}/i.test(href)) {
    return null;
  }
  return href || `filename:${filename}`;
}

function attachmentKeys(content: string): Set<string> {
  if (typeof DOMParser === "undefined") return new Set();
  const parser = new DOMParser();
  const source = parser.parseFromString(
    linkifyPlainTextUrls(normalizeConfluenceCodeMacros(content)),
    "text/html",
  );
  return new Set(
    Array.from(source.querySelectorAll("a[data-attachment], a[href]"))
      .map(attachmentKey)
      .filter((key): key is string => Boolean(key)),
  );
}

export function highlightedRevisionHtml(
  content: string,
  diff: PageRevisionDiff,
  side: "old" | "new",
  comparisonContent: string,
): string {
  if (typeof DOMParser === "undefined") return content;

  const parser = new DOMParser();
  const source = parser.parseFromString(
    linkifyPlainTextUrls(normalizeConfluenceCodeMacros(content)),
    "text/html",
  );
  const comparisonAttachmentKeys = attachmentKeys(comparisonContent);
  const diffKind = side === "old" ? "delete" : "add";
  for (const link of Array.from(source.querySelectorAll("a[data-attachment], a[href]"))) {
    const key = attachmentKey(link);
    if (key && !comparisonAttachmentKeys.has(key)) {
      link.setAttribute("data-diff-kind", diffKind);
    }
  }
  const markerClass = side === "old" ? "wh-diff-delete" : "wh-diff-add";
  const lineClass = side === "old" ? "wh-diff-line-delete" : "wh-diff-line-add";
  const changedLines = new Set(
    diff.lines
      .filter((line) =>
        side === "old"
          ? line.operation === "delete" || line.operation === "replace"
          : line.operation === "add" || line.operation === "replace",
      )
      .map((line) => (side === "old" ? line.old_text : line.new_text) ?? "")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
  for (const block of Array.from(
    source.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr"),
  )) {
    const text = (
      block.tagName === "TR"
        ? Array.from(block.querySelectorAll(":scope > th, :scope > td"))
            .map((cell) => cell.textContent ?? "")
            .join(" ")
        : block.textContent ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (changedLines.has(text)) block.classList.add(lineClass);
  }
  const terms = Array.from(
    new Set(
      diff.lines
        .flatMap((line) =>
          (side === "old" ? line.old_segments : line.new_segments)
            .filter((segment) => segment.operation === (side === "old" ? "delete" : "add"))
            .map((segment) => parser.parseFromString(segment.text, "text/html").body.textContent ?? ""),
        )
        .map((term) => term.replace(/\s+/g, " ").trim())
        .filter((term) => term.length > 1),
    ),
  ).sort((a, b) => b.length - a.length);

  if (terms.length === 0) return source.body.innerHTML;

  const walker = source.createTreeWalker(source.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    let remaining = textNode.nodeValue ?? "";
    if (!remaining.trim()) continue;
    const fragment = source.createDocumentFragment();
    let changed = false;

    while (remaining) {
      let matchIndex = -1;
      let matchTerm = "";
      for (const term of terms) {
        const index = remaining.indexOf(term);
        if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
          matchIndex = index;
          matchTerm = term;
        }
      }
      if (matchIndex < 0) {
        fragment.appendChild(source.createTextNode(remaining));
        break;
      }
      if (matchIndex > 0) {
        fragment.appendChild(source.createTextNode(remaining.slice(0, matchIndex)));
      }
      const mark = source.createElement("mark");
      mark.className = markerClass;
      mark.textContent = matchTerm;
      fragment.appendChild(mark);
      remaining = remaining.slice(matchIndex + matchTerm.length);
      changed = true;
    }

    if (changed && textNode.parentNode) {
      const line = textNode.parentElement?.closest(
        "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr",
      );
      line?.classList.add(lineClass);
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  return source.body.innerHTML;
}

function HighlightedRevisionContent({
  revision,
  comparisonRevision,
  diff,
  side,
}: {
  revision: PageRevisionItem;
  comparisonRevision: PageRevisionItem | undefined;
  diff: PageRevisionDiff;
  side: "old" | "new";
}) {
  const html = useMemo(
    () => highlightedRevisionHtml(revision.content, diff, side, comparisonRevision?.content ?? ""),
    [comparisonRevision?.content, diff, revision.content, side],
  );

  if (revision.content_format !== "html") {
    return <div className="whitespace-pre-wrap">{revision.content}</div>;
  }
  return (
    <div
      className={cn(
        "min-h-full text-foreground",
        readerClassName,
        "revision-history-content",
        "[&_.wh-diff-line-add]:rounded-sm [&_.wh-diff-line-add]:bg-success-bg/70 [&_.wh-diff-line-add]:px-2 [&_.wh-diff-line-delete]:rounded-sm [&_.wh-diff-line-delete]:bg-danger-bg/70 [&_.wh-diff-line-delete]:px-2 [&_.wh-diff-add]:rounded-sm [&_.wh-diff-add]:bg-success-bg [&_.wh-diff-add]:px-0.5 [&_.wh-diff-add]:font-semibold [&_.wh-diff-add]:text-success [&_.wh-diff-delete]:rounded-sm [&_.wh-diff-delete]:bg-danger-bg [&_.wh-diff-delete]:px-0.5 [&_.wh-diff-delete]:font-semibold [&_.wh-diff-delete]:text-danger [&_.wh-diff-delete]:line-through",
      )}
    >
      <RichTextContent content={html} />
    </div>
  );
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

  const [restoring, setRestoring] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const oldContentRef = useRef<HTMLDivElement | null>(null);
  const newContentRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const { t, locale } = useTranslation();

  const syncPanelScroll = useCallback((side: "old" | "new", event: UIEvent<HTMLDivElement>) => {
    if (syncingScrollRef.current) return;
    const source = event.currentTarget;
    const target = side === "old" ? newContentRef.current : oldContentRef.current;
    if (!target) return;

    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;

    syncingScrollRef.current = true;
    target.scrollTop = ratio * Math.max(targetMax, 0);
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  useEffect(() => {
    oldContentRef.current?.scrollTo({ top: 0, left: 0 });
    newContentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [fromVersion, toVersion]);

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
      toast.error(t("history.loadError"));
    } finally {
      setLoadingRevisions(false);
    }
  }, [spaceKey, slug, t]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load revisions when the modal opens
      void fetchRevisions();
    } else {
      setRevisions([]);
      setDiffData(null);
      setShowConfirmRestore(false);
    }
  }, [open, fetchRevisions]);

  // Fetch diff data when selected versions change
  useEffect(() => {
    if (!open || fromVersion === null || toVersion === null) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading state before the diff request resolves
    setLoadingDiff(true);
    getRevisionDiff(spaceKey, slug, fromVersion, toVersion)
      .then((data) => setDiffData(data))
      .catch(() => toast.error(t("history.diffError")))
      .finally(() => setLoadingDiff(false));
  }, [open, spaceKey, slug, fromVersion, toVersion, t]);

  // Restore page handler
  const handleRestore = async () => {
    if (toVersion === null) return;
    setRestoring(true);
    try {
      await restorePageRevision(spaceKey, slug, toVersion);
      toast.success(t("history.restoredToast", { version: toVersion }));
      setShowConfirmRestore(false);
      onOpenChange(false);
      onRestored?.();
    } catch {
      toast.error(t("history.restoreError", { version: toVersion }));
    } finally {
      setRestoring(false);
    }
  };

  const selectedToRev = useMemo(
    () => revisions.find((r) => r.version === toVersion),
    [revisions, toVersion],
  );
  const selectedFromRev = useMemo(
    () => revisions.find((r) => r.version === fromVersion),
    [revisions, fromVersion],
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
            "border-border bg-surface fixed top-[2vh] left-1/2 z-50 h-[min(46rem,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[90rem]",
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
                  <h2 className="font-bold text-foreground text-base">{t("history.title")}</h2>
                  <Badge variant="subtle" className="font-mono text-xs">
                    {revisions.length === 1
                      ? t("history.versionCountOne", { count: revisions.length })
                      : t("history.versionCountMany", { count: revisions.length })}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs truncate max-w-md">
                  {pageTitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 hover:bg-surface-hover cursor-pointer"
                aria-label={t("history.closeAria")}
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Body Content (Split into Left Timeline and Right Diff Container) */}
          <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
            {/* Left Revision Timeline Sidebar */}
            <div className="w-[25rem] shrink-0 overflow-hidden bg-surface-sunken p-3 space-y-2">
              <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold uppercase tracking-wider">
                {t("history.versionsHeading")}
              </div>

              {loadingRevisions ? (
                <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin text-primary" />
                  {t("history.loading")}
                </div>
              ) : revisions.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {t("history.noRevisions")}
                </div>
              ) : (
                <ul className="max-h-[min(42rem,calc(100vh-12rem))] space-y-1.5 overflow-y-auto pr-1">
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
                                <span className="bg-success-bg text-success rounded px-1.5 py-0.5 text-[10px] font-semibold">
                                  {t("history.currentBadge")}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-muted-foreground text-[11px]">
                              {formatDateTime(rev.created_at, locale)}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <div className="bg-primary-subtle text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase">
                              {rev.created_by_full_name
                                ? rev.created_by_full_name.charAt(0)
                                : <User className="size-3" />}
                            </div>
                            <span className="font-medium text-xs text-foreground truncate">
                              {rev.created_by_full_name || rev.created_by_username || t("history.systemAuthor")}
                            </span>
                          </div>

                          {rev.change_summary && rev.change_summary !== "Updated content" ? (
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
                    {t("history.comparing")}{" "}
                    <strong className="text-foreground font-semibold">v{fromVersion}</strong>{" "}
                    {t("history.comparingTo")}{" "}
                    <strong className="text-foreground font-semibold">v{toVersion}</strong>
                  </span>
                </div>

                {selectedToRev && selectedToRev.version !== revisions[0]?.version ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowConfirmRestore(true)}
                    disabled={restoring}
                  >
                    <RotateCcw className="size-3.5" />
                    {t("history.restoreButton", { version: toVersion ?? 0 })}
                  </Button>
                ) : null}
              </div>

              {/* Main Diff Display Panel */}
              <div className="flex min-h-0 flex-1 overflow-hidden p-5">
                {loadingDiff ? (
                  <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
                    <Loader2 className="mr-2 size-5 animate-spin text-primary" />
                    {t("history.calculating")}
                  </div>
                ) : Boolean(diffData) ? (
                  <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
                    {/* Left: Version From */}
                    <div className="border-border bg-surface-sunken flex min-h-0 flex-col overflow-hidden rounded-lg border p-3">
                      <div className="text-muted-foreground mb-3 border-b border-border pb-2 font-sans text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-foreground">
                            v{diffData!.from_version}: {diffData!.from_title}
                          </p>
                          <div className="text-danger flex items-center gap-2 text-sm font-semibold">
                            <CircleMinus className="size-4" />
                            <span>
                              {diffData!.deleted_count === 1
                                ? t("history.removalsOne", { count: diffData!.deleted_count })
                                : t("history.removalsMany", { count: diffData!.deleted_count })}
                            </span>
                          </div>
                        </div>
                        {selectedFromRev ? (
                          <p className="mt-1">
                            <RevisionAuthor
                              username={selectedFromRev.created_by_username}
                              fullName={selectedFromRev.created_by_full_name}
                            />
                            <span className="mx-1">·</span>
                            {formatDateTime(selectedFromRev.created_at, locale)}
                          </p>
                        ) : null}
                      </div>
                      <div
                        ref={oldContentRef}
                        onScroll={(event) => syncPanelScroll("old", event)}
                        className="font-sans min-h-0 flex-1 overflow-y-auto rounded-md bg-surface p-4 text-sm leading-relaxed"
                      >
                        {selectedFromRev?.content_format === "html" ? (
                          <HighlightedRevisionContent revision={selectedFromRev} comparisonRevision={selectedToRev} diff={diffData!} side="old" />
                        ) : (
                          <div className="whitespace-pre-wrap">{selectedFromRev?.content}</div>
                        )}
                      </div>
                    </div>

                    {/* Right: Version To */}
                    <div className="border-border bg-surface-sunken flex min-h-0 flex-col overflow-hidden rounded-lg border p-3">
                      <div className="text-muted-foreground mb-3 border-b border-border pb-2 font-sans text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-foreground">
                            v{diffData!.to_version}: {diffData!.to_title}
                          </p>
                          <div className="text-success flex items-center gap-2 text-sm font-semibold">
                            <CirclePlus className="size-4" />
                            <span>
                              {diffData!.added_count === 1
                                ? t("history.additionsOne", { count: diffData!.added_count })
                                : t("history.additionsMany", { count: diffData!.added_count })}
                            </span>
                          </div>
                        </div>
                        {selectedToRev ? (
                          <p className="mt-1">
                            <RevisionAuthor
                              username={selectedToRev.created_by_username}
                              fullName={selectedToRev.created_by_full_name}
                            />
                            <span className="mx-1">·</span>
                            {formatDateTime(selectedToRev.created_at, locale)}
                          </p>
                        ) : null}
                      </div>
                      <div
                        ref={newContentRef}
                        onScroll={(event) => syncPanelScroll("new", event)}
                        className="font-sans min-h-0 flex-1 overflow-y-auto rounded-md bg-surface p-4 text-sm leading-relaxed"
                      >
                        {selectedToRev?.content_format === "html" ? (
                          <HighlightedRevisionContent revision={selectedToRev} comparisonRevision={selectedFromRev} diff={diffData!} side="new" />
                        ) : (
                          <div className="whitespace-pre-wrap">{selectedToRev?.content}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : diffData ? (
                  /* Inline View */
                  <div className="space-y-3 max-w-4xl mx-auto">
                    {diffData.title_changed ? (
                      <div className="border-warning/30 bg-warning-bg text-warning rounded-lg border p-3 font-sans text-xs">
                        <strong>{t("history.titleChanged")}</strong> &ldquo;{diffData.from_title}&rdquo; → &ldquo;<strong className="text-foreground">{diffData.to_title}</strong>&rdquo;
                      </div>
                    ) : null}

                    <div className="border-border bg-surface-sunken overflow-hidden rounded-lg border">
                      {diffData.lines.length > 0
                        ? diffData.lines.map((line, index) => (
                            <div key={index}>
                              {line.operation === "delete" || line.operation === "replace" ? (
                                <DiffLine line={line} side="old" />
                              ) : null}
                              {line.operation === "add" || line.operation === "equal" || line.operation === "replace" ? (
                                <DiffLine line={line} side="new" />
                              ) : null}
                            </div>
                          ))
                        : diffData.chunks.map((chunk, index) => (
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
                  <div className="py-12 text-center text-muted-foreground">{t("history.selectRevisions")}</div>
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
                    <h3 className="font-bold text-foreground text-base">{t("history.restoreTitle", { version: toVersion ?? 0 })}</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("history.restoreDescription", { version: toVersion ?? 0 })}
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
                    {t("history.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={restoring}
                    onClick={handleRestore}
                  >
                    {restoring ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {t("history.confirmRestore")}
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

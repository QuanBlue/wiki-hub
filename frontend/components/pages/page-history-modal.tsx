"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { generateJSON, type JSONContent } from "@tiptap/core";
import {
  CircleMinus,
  CirclePlus,
  Clock,
  FileText,
  GitCompare,
  Loader2,
  RotateCcw,
  Sparkles,
  User,
  X,
} from "lucide-react";
import {
  type UIEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import {
  DiffViewToggle,
  LineDiff,
  revisionHtml,
  useLineDiff,
} from "@/components/pages/line-diff";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import {
  linkifyPlainTextUrls,
  normalizeConfluenceCodeMacros,
  readOnlyEditorExtensions,
  readerClassName,
} from "@/components/pages/rich-text-editor";
import {
  getRevisionDiff,
  getRevisionDiffSummary,
  listPageRevisions,
  restorePageRevision,
  type RevisionDiffSummary,
} from "@/lib/revisions";
import { aiStatus } from "@/lib/ai-summary";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PageRevisionDiff, PageRevisionItem } from "@/types/api";

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
  for (const link of Array.from(
    source.querySelectorAll("a[data-attachment], a[href]"),
  )) {
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
    source.querySelectorAll(
      "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr",
    ),
  )) {
    const text = (
      block.tagName === "TR"
        ? Array.from(block.querySelectorAll(":scope > th, :scope > td"))
            .map((cell) => cell.textContent ?? "")
            .join(" ")
        : (block.textContent ?? "")
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
            .filter(
              (segment) =>
                segment.operation === (side === "old" ? "delete" : "add"),
            )
            .map(
              (segment) =>
                parser.parseFromString(segment.text, "text/html").body
                  .textContent ?? "",
            ),
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
        fragment.appendChild(
          source.createTextNode(remaining.slice(0, matchIndex)),
        );
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
  return (
    <HighlightedDiffContent
      content={revision.content}
      comparisonContent={comparisonRevision?.content ?? ""}
      diff={diff}
      side={side}
    />
  );
}

/**
 * One side of a two-column comparison: the page as the reader shows it, with the blocks and
 * words that differ from the other side marked (red removed on the old side, green added on
 * the new). Shared by the page history and the content health report's page comparison.
 */
/** Blocks the word and line marks already cover: their text is what changes. */
const TEXT_BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
]);

/**
 * The page's top-level blocks that the other side does not have, of the kinds the text marks
 * miss: a diagram, a code block, a callout, a quote, a table, an image, an embed - anything
 * but plain paragraphs, headings and lists. Compared by their whole markup, so a diagram whose
 * source changed, or a table whose column widths did, counts as changed.
 */
/** The reader's top-level node types the word and line marks already cover. */
const TEXT_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
]);

/**
 * The page's top-level blocks that the other side does not have, of the kinds the text marks
 * miss: a diagram, a code block, a callout, a quote, a table, an image, an embed - anything
 * but plain paragraphs, headings and lists.
 *
 * Read with the reader's own parser (the same extensions), so block ``index`` is the block it
 * draws at that position, and two blocks are compared by every attribute it keeps - a diagram
 * that was only resized or realigned counts as changed. Without the reader's extensions (some
 * tests mock it) the HTML elements are compared instead.
 */
export function changedBlocks(
  content: string,
  comparisonContent: string,
): { total: number; blocks: { index: number; text: string }[] } {
  if (typeof DOMParser === "undefined") return { total: 0, blocks: [] };
  const prepare = (html: string) =>
    linkifyPlainTextUrls(normalizeConfluenceCodeMacros(html));
  type Block = { key: string; text: string; covered: boolean };
  let read: (html: string) => Block[];
  if (Array.isArray(readOnlyEditorExtensions)) {
    read = (html) =>
      (
        generateJSON(prepare(html), readOnlyEditorExtensions).content as JSONContent[]
      ).map((node) => ({
        key: JSON.stringify(node),
        text: jsonText(node),
        covered: TEXT_NODE_TYPES.has(node.type ?? ""),
      }));
  } else {
    const parser = new DOMParser();
    read = (html) =>
      Array.from(
        parser.parseFromString(prepare(html), "text/html").body.children,
      ).map((el) => ({
        key: el.outerHTML.replace(/\s+/g, " ").trim(),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        covered: TEXT_BLOCK_TAGS.has(el.tagName),
      }));
  }
  const others = new Map<string, number>();
  for (const block of read(comparisonContent)) {
    others.set(block.key, (others.get(block.key) ?? 0) + 1);
  }
  const own = read(content);
  const blocks: { index: number; text: string }[] = [];
  own.forEach((block, index) => {
    const left = others.get(block.key) ?? 0;
    if (left > 0) {
      others.set(block.key, left - 1);
      return;
    }
    if (!block.covered) blocks.push({ index, text: block.text });
  });
  return { total: own.length, blocks };
}

/** A node's words, as the reader would show them. */
function jsonText(node: JSONContent): string {
  const words = (part: JSONContent): string =>
    part.text ?? (part.content ?? []).map(words).join(" ");
  return words(node).replace(/\s+/g, " ").trim();
}

export function HighlightedDiffContent({
  content,
  comparisonContent,
  diff,
  side,
}: {
  content: string;
  comparisonContent: string;
  diff: PageRevisionDiff;
  side: "old" | "new";
}) {
  const html = useMemo(
    () => highlightedRevisionHtml(content, diff, side, comparisonContent),
    [comparisonContent, diff, content, side],
  );
  const changed = useMemo(
    () => changedBlocks(content, comparisonContent),
    [content, comparisonContent],
  );
  const scope = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [marked, setMarked] = useState<number[]>([]);

  // The reader turns the HTML into its own nodes (a diagram, a code card, a callout), which
  // keep no class of ours; so the changed blocks are found again once it has drawn them, by
  // position - or, if it drew a different number of blocks, by their words.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const find = () => {
      const root = containerRef.current?.querySelector(".ProseMirror");
      const children = root ? Array.from(root.children) : [];
      if (children.length === 0 && tries++ < 60) {
        frame = requestAnimationFrame(find);
        return;
      }
      if (children.length === changed.total) {
        setMarked(changed.blocks.map((block) => block.index));
        return;
      }
      const texts = new Set(
        changed.blocks.map((block) => block.text).filter(Boolean),
      );
      setMarked(
        children.flatMap((child, index) =>
          texts.has((child.textContent ?? "").replace(/\s+/g, " ").trim())
            ? [index]
            : [],
        ),
      );
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [html, changed]);

  const tone = side === "old" ? "danger" : "success";
  const css = marked
    .map(
      (index) =>
        `[data-diff-scope="${scope}"] .ProseMirror > :nth-child(${index + 1}) { position: relative; }\n` +
        `[data-diff-scope="${scope}"] .ProseMirror > :nth-child(${index + 1})::after {` +
        ` content: ""; position: absolute; inset: -4px; z-index: 1; pointer-events: none;` +
        ` border-radius: 6px; background-color: color-mix(in srgb, var(--color-${tone}) 22%, transparent); }`,
    )
    .join("\n");

  return (
    <div
      ref={containerRef}
      data-diff-scope={scope}
      className={cn(
        "text-foreground min-h-full",
        readerClassName,
        "revision-history-content",
        "[&_.wh-diff-line-add]:bg-success-bg/70 [&_.wh-diff-line-delete]:bg-danger-bg/70 [&_.wh-diff-add]:bg-success-bg [&_.wh-diff-add]:text-success [&_.wh-diff-delete]:bg-danger-bg [&_.wh-diff-delete]:text-danger [&_.wh-diff-add]:rounded-sm [&_.wh-diff-add]:px-0.5 [&_.wh-diff-add]:font-semibold [&_.wh-diff-delete]:rounded-sm [&_.wh-diff-delete]:px-0.5 [&_.wh-diff-delete]:font-semibold [&_.wh-diff-delete]:line-through [&_.wh-diff-line-add]:rounded-sm [&_.wh-diff-line-add]:px-2 [&_.wh-diff-line-delete]:rounded-sm [&_.wh-diff-line-delete]:px-2",
      )}
    >
      {css ? <style>{css}</style> : null}
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
  defaultView = "pages",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceKey: string;
  slug: string;
  pageTitle: string;
  onRestored?: () => void;
  /** How the comparison opens: numbered, aligned lines, or each version as it reads. */
  defaultView?: "lines" | "pages";
}) {
  const [revisions, setRevisions] = useState<PageRevisionItem[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);

  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const toVersion = selectedVersion;
  const fromVersion = useMemo(() => {
    if (selectedVersion === null || revisions.length === 0) return null;
    const selectedIndex = revisions.findIndex(
      (r) => r.version === selectedVersion,
    );
    if (selectedIndex === -1) return null;

    if (selectedVersion === 1) return 0;
    if (selectedIndex < revisions.length - 1) {
      return revisions[selectedIndex + 1].version;
    }
    return selectedVersion;
  }, [selectedVersion, revisions]);

  const [diffData, setDiffData] = useState<PageRevisionDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [aiAvailable, setAiAvailable] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<RevisionDiffSummary | null>(
    null,
  );
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [restoring, setRestoring] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const oldContentRef = useRef<HTMLDivElement | null>(null);
  const newContentRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const { t, locale } = useTranslation();

  const fetchDiffSummary = useCallback(async () => {
    if (!spaceKey || !slug || fromVersion === null || toVersion === null)
      return;
    setLoadingSummary(true);
    try {
      const data = await getRevisionDiffSummary(spaceKey, slug, {
        from_version: fromVersion,
        to_version: toVersion,
        lang: locale,
      });
      setSummaryData(data);
    } catch {
      toast.error(t("history.summaryError"));
    } finally {
      setLoadingSummary(false);
    }
  }, [spaceKey, slug, fromVersion, toVersion, locale, t]);

  const syncPanelScroll = useCallback(
    (side: "old" | "new", event: UIEvent<HTMLDivElement>) => {
      const source = event.currentTarget;
      const target =
        side === "old" ? newContentRef.current : oldContentRef.current;
      if (syncingScrollRef.current || !target) return;

      const sourceMax = source.scrollHeight - source.clientHeight;
      const targetMax = target.scrollHeight - target.clientHeight;
      const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;

      syncingScrollRef.current = true;
      target.scrollTop = ratio * Math.max(targetMax, 0);
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    },
    [],
  );

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
        setSelectedVersion(data[0].version);
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
      void aiStatus()
        .then((status) => setAiAvailable(Boolean(status?.enabled)))
        .catch(() => setAiAvailable(false));
    } else {
      setRevisions([]);
      setDiffData(null);
      setShowConfirmRestore(false);
      setShowAiSummary(false);
      setSummaryData(null);
      setSelectedVersion(null);
    }
  }, [open, fetchRevisions]);

  // Auto-fetch AI summary when showAiSummary is open and versions change (or when opened)
  useEffect(() => {
    setSummaryData(null);
    if (!open || !showAiSummary || fromVersion === null || toVersion === null) {
      return;
    }

    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading state before summary resolves
    setLoadingSummary(true);
    getRevisionDiffSummary(spaceKey, slug, {
      from_version: fromVersion,
      to_version: toVersion,
      lang: locale,
    })
      .then((data) => {
        if (active) {
          setSummaryData(data);
        }
      })
      .catch(() => {
        if (active) {
          toast.error(t("history.summaryError"));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingSummary(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, showAiSummary, spaceKey, slug, fromVersion, toVersion, locale, t]);

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

  const restoreTargetVersion =
    selectedVersion !== null && selectedVersion !== revisions[0]?.version
      ? selectedVersion
      : null;

  // Restore page handler
  const handleRestore = async () => {
    if (restoreTargetVersion === null) return;
    setRestoring(true);
    try {
      await restorePageRevision(spaceKey, slug, restoreTargetVersion);
      toast.success(
        t("history.restoredToast", { version: restoreTargetVersion }),
      );
      setShowConfirmRestore(false);
      onOpenChange(false);
      onRestored?.();
    } catch {
      toast.error(t("history.restoreError", { version: restoreTargetVersion }));
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
  const isV1 = fromVersion === 0;
  // "Line by line" (numbered, aligned lines) or "As pages" (each version as it reads).
  const [diffView, setDiffView] = useState<"lines" | "pages">(defaultView);
  const lineDiff = useLineDiff(
    selectedToRev && (selectedFromRev || isV1)
      ? selectedFromRev && !isV1
        ? revisionHtml(selectedFromRev)
        : ""
      : null,
    selectedToRev ? revisionHtml(selectedToRev) : null,
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
            // Centred on the screen, like every other dialog in the app.
            "border-border bg-surface fixed top-1/2 left-1/2 z-50 h-[min(46rem,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[90rem]",
            "-translate-x-1/2 -translate-y-1/2 rounded-xl border shadow-2xl outline-none",
            "flex max-h-[90vh] flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header Bar */}
          <div className="border-border bg-surface-sunken flex items-center justify-between border-b px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-lg">
                <Clock className="size-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-foreground text-base font-bold">
                    {t("history.title")}
                  </h2>
                  <Badge variant="subtle" className="font-mono text-xs">
                    {revisions.length === 1
                      ? t("history.versionCountOne", {
                          count: revisions.length,
                        })
                      : t("history.versionCountMany", {
                          count: revisions.length,
                        })}
                  </Badge>
                </div>
                <p className="text-muted-foreground max-w-md truncate text-xs">
                  {pageTitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover cursor-pointer rounded-lg p-1.5"
                aria-label={t("history.closeAria")}
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Body Content (Split into Left Timeline and Right Diff Container) */}
          <div className="divide-border flex min-h-0 flex-1 divide-x overflow-hidden">
            {/* Left Revision Timeline Sidebar */}
            <div className="bg-surface-sunken w-[25rem] shrink-0 space-y-2 overflow-hidden p-3">
              <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wider uppercase">
                {t("history.versionsHeading")}
              </div>

              {loadingRevisions ? (
                <div className="text-muted-foreground flex items-center justify-center py-12 text-xs">
                  <Loader2 className="text-primary mr-2 size-4 animate-spin" />
                  {t("history.loading")}
                </div>
              ) : revisions.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center text-xs">
                  {t("history.noRevisions")}
                </div>
              ) : (
                <ul className="max-h-[min(42rem,calc(100vh-12rem))] space-y-1.5 overflow-y-auto pr-1">
                  {revisions.map((rev) => {
                    const isLatest = rev.version === revisions[0].version;
                    const isSelected = rev.version === selectedVersion;

                    return (
                      <li key={rev.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedVersion === rev.version) return;
                            setSelectedVersion(rev.version);
                          }}
                          className={cn(
                            "w-full cursor-pointer rounded-lg border p-3 text-left transition-colors",
                            isSelected
                              ? "bg-surface border-primary/50 shadow-xs"
                              : "bg-surface/50 hover:bg-surface hover:border-border border-transparent",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={isSelected ? "default" : "subtle"}
                                className="font-mono text-xs"
                              >
                                v{rev.version}
                              </Badge>
                              {isLatest ? (
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
                              {rev.created_by_full_name ? (
                                rev.created_by_full_name.charAt(0)
                              ) : (
                                <User className="size-3" />
                              )}
                            </div>
                            <span className="text-foreground truncate text-xs font-medium">
                              {rev.created_by_full_name ||
                                rev.created_by_username ||
                                t("history.systemAuthor")}
                            </span>
                          </div>

                          {rev.change_summary &&
                          rev.change_summary !== "Updated content" ? (
                            <p className="text-muted-foreground mt-1.5 truncate text-[11px] italic">
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
            <div className="bg-surface flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* Diff Header Bar */}
              <div className="border-border bg-surface/50 flex items-center justify-between border-b px-5 py-2.5 text-xs">
                <div className="text-muted-foreground flex items-center gap-3">
                  <GitCompare className="text-primary size-4" />
                  {isV1 ? (
                    <span>
                      <strong className="text-foreground font-semibold">
                        {t("history.initialVersionTitle", {
                          version: toVersion ?? 1,
                        })}
                      </strong>{" "}
                      <span className="text-muted-foreground font-normal">
                        ({t("history.firstVersionNote")})
                      </span>
                    </span>
                  ) : (
                    <span>
                      {t("history.comparing")}{" "}
                      <strong className="text-foreground font-semibold">
                        v{fromVersion}
                      </strong>{" "}
                      {t("history.comparingTo")}{" "}
                      <strong className="text-foreground font-semibold">
                        v{toVersion}
                      </strong>
                    </span>
                  )}
                  {isV1 ? null : (
                    <>
                      <span className="bg-border h-5 w-px" aria-hidden />
                      <DiffViewToggle value={diffView} onChange={setDiffView} />
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {aiAvailable ? (
                    <Button
                      size="sm"
                      variant={showAiSummary ? "primary" : "secondary"}
                      onClick={() => setShowAiSummary((prev) => !prev)}
                      className={cn(
                        "gap-1.5",
                        showAiSummary
                          ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm"
                          : "hover:text-primary",
                      )}
                    >
                      <Sparkles
                        className={cn(
                          "size-3.5 transition-colors",
                          showAiSummary
                            ? "text-primary-foreground"
                            : "text-primary",
                        )}
                      />
                      {showAiSummary
                        ? t("history.aiSummaryHide")
                        : t("history.aiSummaryButton")}
                    </Button>
                  ) : null}

                  {restoreTargetVersion !== null &&
                  restoreTargetVersion > 0 &&
                  restoreTargetVersion !== revisions[0]?.version ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowConfirmRestore(true)}
                      disabled={restoring}
                      className="gap-1.5"
                    >
                      <RotateCcw className="size-3.5" />
                      {restoring
                        ? t("history.restoring")
                        : t("history.restoreButton", {
                            version: restoreTargetVersion,
                          })}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* AI Diff Summary Panel */}
              {showAiSummary ? (
                <div className="border-primary/20 bg-surface-sunken/40 shrink-0 border-b px-5 py-4 transition-colors">
                  <div className="border-primary/35 from-primary-subtle/80 via-primary-subtle/50 to-primary-subtle/30 dark:from-primary-subtle/30 dark:via-primary-subtle/20 dark:to-primary-subtle/10 space-y-3 rounded-xl border bg-gradient-to-br p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 text-primary border-primary/20 flex size-6.5 items-center justify-center rounded-lg border shadow-2xs">
                          <Sparkles className="size-3.5" aria-hidden />
                        </div>
                        <h4 className="text-primary text-xs font-semibold tracking-tight">
                          {isV1
                            ? t("history.aiSummaryInitialTitle", {
                                version: toVersion ?? 1,
                              })
                            : t("history.aiSummaryTitle", {
                                from: fromVersion ?? "",
                                to: toVersion ?? "",
                              })}
                        </h4>
                        {summaryData?.cached ? (
                          <Badge
                            variant="info"
                            className="px-1.5 py-0 font-mono text-[10px]"
                          >
                            Cached
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void fetchDiffSummary()}
                          disabled={loadingSummary}
                          title={t("history.refresh")}
                          className="text-primary hover:text-primary-hover hover:bg-primary/10 active:bg-primary/20 focus-visible:ring-ring h-7 gap-1.5 rounded-md px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {loadingSummary ? (
                            <Loader2 className="text-primary size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                          <span>{t("history.refresh")}</span>
                        </Button>
                        <button
                          type="button"
                          onClick={() => setShowAiSummary(false)}
                          className="text-primary/70 hover:text-primary hover:bg-primary/10 active:bg-primary/20 focus-visible:ring-ring cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          aria-label="Close AI diff summary"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Summary Result */}
                    {loadingSummary ? (
                      <div className="text-primary/80 flex items-center justify-center py-6 text-xs">
                        <Loader2 className="text-primary mr-2 size-4 animate-spin" />
                        {t("history.summarizing")}
                      </div>
                    ) : summaryData ? (
                      <div className="bg-surface/85 dark:bg-surface/65 border-primary/20 text-foreground max-h-48 overflow-y-auto rounded-lg border p-3.5 text-xs leading-relaxed shadow-2xs backdrop-blur-xs">
                        <IssueMarkdown
                          source={summaryData.summary}
                          autolink
                          rich
                          className="space-y-2 text-xs leading-relaxed [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_li]:text-xs [&_p]:text-xs [&_ul]:my-1 [&_ul]:space-y-1"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Main Diff Display Panel */}
              <div className="flex min-h-0 flex-1 overflow-hidden p-5">
                {loadingDiff ? (
                  <div className="text-muted-foreground flex h-full w-full flex-1 items-center justify-center py-24 text-sm">
                    <Loader2 className="text-primary mr-2 size-5 animate-spin" />
                    {t("history.calculating")}
                  </div>
                ) : isV1 && selectedToRev ? (
                  <div className="border-border bg-surface-sunken flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border p-3">
                    <div className="border-border mb-3 border-b pb-2 text-xs">
                      <p className="text-foreground text-sm font-semibold">
                        v{selectedToRev.version}: {selectedToRev.title}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        <RevisionAuthor
                          username={selectedToRev.created_by_username}
                          fullName={selectedToRev.created_by_full_name}
                        />
                        <span className="mx-1">·</span>
                        {formatDateTime(selectedToRev.created_at, locale)}
                        <span className="mx-1">·</span>
                        {t("history.firstVersionNote")}
                      </p>
                    </div>
                    <div className="bg-surface min-h-0 flex-1 overflow-auto rounded-md p-4 text-sm leading-relaxed">
                      {selectedToRev.content_format === "html" ? (
                        <div className={cn("text-foreground", readerClassName)}>
                          <RichTextContent content={selectedToRev.content} />
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">
                          {selectedToRev.content}
                        </div>
                      )}
                    </div>
                  </div>
                ) : diffData &&
                  selectedToRev &&
                  selectedFromRev &&
                  diffView === "lines" &&
                  lineDiff ? (
                  <LineDiff
                    diff={lineDiff}
                    counts={[
                      lineDiff.onlyOld === 1
                        ? t("history.removalsOne", { count: lineDiff.onlyOld })
                        : t("history.removalsMany", {
                            count: lineDiff.onlyOld,
                          }),
                      lineDiff.onlyNew === 1
                        ? t("history.additionsOne", { count: lineDiff.onlyNew })
                        : t("history.additionsMany", {
                            count: lineDiff.onlyNew,
                          }),
                    ]}
                    headings={[
                        <span key="old" className="text-muted-foreground">
                          <strong className="text-foreground font-semibold">
                            v{selectedFromRev.version}: {selectedFromRev.title}
                          </strong>
                          {" · "}
                          {formatDateTime(selectedFromRev.created_at, locale)}
                        </span>,
                      <span key="new" className="text-muted-foreground">
                        <strong className="text-foreground font-semibold">
                          v{selectedToRev.version}: {selectedToRev.title}
                        </strong>
                        {" · "}
                        {formatDateTime(selectedToRev.created_at, locale)}
                      </span>,
                    ]}
                  />
                ) : diffData && selectedToRev && selectedFromRev ? (
                  <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
                    {/* Left: previous version */}
                    <div className="border-border bg-surface-sunken flex min-h-0 flex-col overflow-hidden rounded-lg border p-3">
                        <>
                          <div className="text-muted-foreground border-border mb-3 border-b pb-2 font-sans text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-foreground font-semibold">
                                v{diffData.from_version}: {diffData.from_title}
                              </p>
                              <div className="text-danger flex items-center gap-2 text-sm font-semibold">
                                <CircleMinus className="size-4" />
                                <span>
                                  {(lineDiff?.onlyOld ?? diffData.deleted_count) === 1
                                    ? t("history.removalsOne", {
                                        count: (lineDiff?.onlyOld ?? diffData.deleted_count),
                                      })
                                    : t("history.removalsMany", {
                                        count: (lineDiff?.onlyOld ?? diffData.deleted_count),
                                      })}
                                </span>
                              </div>
                            </div>
                            <p className="mt-1">
                              <RevisionAuthor
                                username={selectedFromRev.created_by_username}
                                fullName={selectedFromRev.created_by_full_name}
                              />
                              <span className="mx-1">·</span>
                              {formatDateTime(
                                selectedFromRev.created_at,
                                locale,
                              )}
                            </p>
                          </div>
                          <div
                            ref={oldContentRef}
                            onScroll={(event) => syncPanelScroll("old", event)}
                            className="bg-surface min-h-0 flex-1 overflow-y-auto rounded-md p-4 font-sans text-sm leading-relaxed"
                          >
                            {selectedFromRev.content_format === "html" ? (
                              <HighlightedRevisionContent
                                revision={selectedFromRev}
                                comparisonRevision={selectedToRev}
                                diff={diffData}
                                side="old"
                              />
                            ) : (
                              <div className="whitespace-pre-wrap">
                                {selectedFromRev.content}
                              </div>
                            )}
                          </div>
                        </>
                    </div>

                    {/* Right: Version To */}
                    <div className="border-border bg-surface-sunken flex min-h-0 flex-col overflow-hidden rounded-lg border p-3">
                      <div className="text-muted-foreground border-border mb-3 border-b pb-2 font-sans text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-foreground font-semibold">
                            v{diffData.to_version}: {diffData.to_title}
                          </p>
                          <div className="text-success flex items-center gap-2 text-sm font-semibold">
                            <CirclePlus className="size-4" />
                            <span>
                              {(lineDiff?.onlyNew ?? diffData.added_count) === 1
                                ? t("history.additionsOne", {
                                    count: (lineDiff?.onlyNew ?? diffData.added_count),
                                  })
                                : t("history.additionsMany", {
                                    count: (lineDiff?.onlyNew ?? diffData.added_count),
                                  })}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1">
                          <RevisionAuthor
                            username={selectedToRev.created_by_username}
                            fullName={selectedToRev.created_by_full_name}
                          />
                          <span className="mx-1">·</span>
                          {formatDateTime(selectedToRev.created_at, locale)}
                        </p>
                      </div>
                      <div
                        ref={newContentRef}
                        onScroll={(event) => syncPanelScroll("new", event)}
                        className="bg-surface min-h-0 flex-1 overflow-y-auto rounded-md p-4 font-sans text-sm leading-relaxed"
                      >
                        {selectedToRev.content_format === "html" ? (
                          <HighlightedRevisionContent
                            revision={selectedToRev}
                            comparisonRevision={selectedFromRev}
                            diff={diffData}
                            side="new"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {selectedToRev.content}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground flex h-full w-full flex-1 items-center justify-center py-12 text-center">
                    {t("history.selectRevisions")}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Confirmation Dialog for Restoration */}
          {showConfirmRestore ? (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
              <div className="border-border bg-surface w-full max-w-md space-y-4 rounded-xl border p-6 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="bg-warning-bg text-warning flex size-10 items-center justify-center rounded-full">
                    <RotateCcw className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-base font-bold">
                      {t("history.restoreTitle", {
                        version: restoreTargetVersion ?? 0,
                      })}
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("history.restoreDescription", {
                        version: restoreTargetVersion ?? 0,
                      })}
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
                    {restoring ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
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

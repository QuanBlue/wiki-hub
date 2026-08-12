"use client";

import {
  Check,
  CodeXml,
  ChevronDown,
  ChevronRight,
  FileText,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  Tag,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { useSidebar } from "@/components/layout/sidebar-context";
import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { MovePageDialog } from "@/components/pages/move-page-dialog";
import { SourceCodeEditor } from "@/components/pages/source-code-editor";
import {
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { PageContentFormat, Space, SpaceMember, WikiPage } from "@/types/api";
import type { CSSProperties } from "react";

const SPACE_SIDEBAR_WIDTH_KEY = "wikihub:space-sidebar-width";
const SPACE_SIDEBAR_WIDTH_COOKIE = "wikihub_space_sidebar_width";
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_PREVIEW_SPLIT = 30;
const MAX_PREVIEW_SPLIT = 70;
const SAVED_PAGE_KEYS_STORAGE = "wikihub:saved-page-keys";
const SAVED_PAGE_KEYS_EVENT = "wikihub:saved-pages-changed";
let savedPageKeysSnapshot: string[] = [];

function getSavedPageKeys(): string[] {
  if (typeof window === "undefined") return savedPageKeysSnapshot;

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SAVED_PAGE_KEYS_STORAGE) ?? "[]");
    const nextKeys = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    if (
      nextKeys.length === savedPageKeysSnapshot.length &&
      nextKeys.every((key, index) => key === savedPageKeysSnapshot[index])
    ) {
      return savedPageKeysSnapshot;
    }
    savedPageKeysSnapshot = nextKeys;
    return savedPageKeysSnapshot;
  } catch {
    return savedPageKeysSnapshot;
  }
}

function subscribeToSavedPages(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SAVED_PAGE_KEYS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SAVED_PAGE_KEYS_EVENT, onStoreChange);
  };
}

function savePageKeys(keys: string[]) {
  savedPageKeysSnapshot = keys;
  try {
    window.localStorage.setItem(SAVED_PAGE_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // The current session can still reflect the saved state if storage is unavailable.
  }
  window.dispatchEvent(new Event(SAVED_PAGE_KEYS_EVENT));
}

type PageLikeStatus = { liked_by_me: boolean; like_count: number };

type EditMode = "normal" | "markdown" | "html";

function formatForMode(mode: EditMode): PageContentFormat {
  return mode === "markdown" ? "markdown" : "html";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdownInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** A small, predictable Markdown subset for the source editor and preview. */
function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    // HTML blocks are valid Markdown. The HTML-to-Markdown conversion emits
    // them for rich structures that Markdown cannot describe without loss.
    const htmlBlock = /^<([a-z][\w-]*)\b[^>]*>/i.exec(line);
    if (htmlBlock) {
      const tagName = htmlBlock[1].toLowerCase();
      if (["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"].includes(tagName)) {
        blocks.push(lines[index]);
        index += 1;
        continue;
      }
      const closingTag = new RegExp(`</${tagName}\\s*>`, "i");
      const htmlLines = [lines[index]];
      index += 1;
      while (index < lines.length && !closingTag.test(htmlLines.join("\n"))) {
        htmlLines.push(lines[index]);
        index += 1;
      }
      blocks.push(htmlLines.join("\n"));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderMarkdownInline(lines[index].trim().slice(2))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(
          `<li>${renderMarkdownInline(lines[index].trim().replace(/^\d+\.\s+/, ""))}</li>`,
        );
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    blocks.push(`<p>${renderMarkdownInline(line)}</p>`);
    index += 1;
  }
  return blocks.join("");
}

function htmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const markdownBlocks = new Set(["P", "H1", "H2", "H3", "UL", "OL"]);
  const markdownInline = new Set(["A", "B", "BR", "CODE", "EM", "I", "LI", "STRONG"]);
  const requiresEmbeddedHtml = (element: Element): boolean =>
    !markdownBlocks.has(element.tagName) ||
    element.matches("[style], [colspan], [rowspan]") ||
    Boolean(element.querySelector("[style], [colspan], [rowspan]")) ||
    Array.from(element.querySelectorAll("*")).some(
      (child) => !markdownInline.has(child.tagName),
    );
  const inline = (element: Element): string => {
    const content = Array.from(element.childNodes)
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
        if (!(node instanceof Element)) return "";
        const text = inline(node);
        if (node.tagName === "STRONG" || node.tagName === "B") return `**${text}**`;
        if (node.tagName === "EM" || node.tagName === "I") return `_${text}_`;
        if (node.tagName === "CODE") return `\`${text}\``;
        if (node.tagName === "A") return `[${text}](${node.getAttribute("href") ?? ""})`;
        if (node.tagName === "BR") return "\n";
        return text;
      })
      .join("");
    return content;
  };

  return Array.from(document.body.children)
    .map((element) => {
      // Tables, colours, cell backgrounds, merged cells and other unsupported
      // rich nodes stay as HTML embedded in the Markdown source.
      if (requiresEmbeddedHtml(element)) return prettyHtml(element.outerHTML);
      const text = inline(element).trim();
      if (/^H[1-3]$/.test(element.tagName)) {
        return `${"#".repeat(Number(element.tagName[1]))} ${text}`;
      }
      if (element.tagName === "UL") {
        return Array.from(element.children)
          .map((item) => `- ${inline(item).trim()}`)
          .join("\n");
      }
      if (element.tagName === "OL") {
        return Array.from(element.children)
          .map((item, index) => `${index + 1}. ${inline(item).trim()}`)
          .join("\n");
      }
      return text;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Format generated HTML source without changing its elements or attributes. */
function prettyHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const blockTags = new Set([
    "BLOCKQUOTE",
    "COL",
    "COLGROUP",
    "DIV",
    "FIGURE",
    "LI",
    "OL",
    "P",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);

  const openingTag = (element: Element): string => {
    const attributes = Array.from(element.attributes)
      .map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`)
      .join("");
    return `<${element.tagName.toLowerCase()}${attributes}>`;
  };

  const renderElement = (element: Element, depth: number): string[] => {
    const indent = "  ".repeat(depth);
    const hasBlockChildren = Array.from(element.children).some((child) =>
      blockTags.has(child.tagName),
    );

    // Keep paragraphs and inline markup compact so their text spacing remains
    // exactly as authored; expand only structural containers.
    if (!hasBlockChildren) return [`${indent}${element.outerHTML}`];

    const lines = [`${indent}${openingTag(element)}`];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        lines.push(`${"  ".repeat(depth + 1)}${escapeHtml(child.textContent)}`);
      } else if (child instanceof Element) {
        lines.push(...renderElement(child, depth + 1));
      }
    }
    lines.push(`${indent}</${element.tagName.toLowerCase()}>`);
    return lines;
  };

  return Array.from(document.body.children)
    .flatMap((element) => renderElement(element, 0))
    .join("\n");
}

function prettyMarkdownEmbeddedHtml(markdown: string): string {
  return markdown.replace(
    /<(table|blockquote|div|figure|ol|pre|ul)\b[\s\S]*?<\/\1\s*>/gi,
    (block) => prettyHtml(block),
  );
}

function MarkdownContent({ content }: { content: string }) {
  return <RichTextContent content={markdownToHtml(content)} />;
}

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
  className,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
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
        className,
      )}
    >
      {children}
    </Link>
  );
}

function PageTree({
  pages,
  spaceKey,
  activeSlug,
}: {
  pages: WikiPage[];
  spaceKey: string;
  activeSlug: string | null;
}) {
  const pagesByParent = useMemo(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    const grouped = new Map<string | null, WikiPage[]>();
    for (const page of pages) {
      const parentId =
        page.parent_id && pageIds.has(page.parent_id) ? page.parent_id : null;
      const siblings = grouped.get(parentId) ?? [];
      siblings.push(page);
      grouped.set(parentId, siblings);
    }
    return grouped;
  }, [pages]);
  const [expandedPageIds, setExpandedPageIds] = useState(
    () =>
      new Set(
        [...pagesByParent.entries()]
          .filter(([, children]) => children.length > 0)
          .map(([pageId]) => pageId)
          .filter((pageId): pageId is string => pageId !== null),
      ),
  );

  useEffect(() => {
    const activePage = pages.find((page) => page.slug === activeSlug);
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const ancestorIds = new Set<string>();
    let parentId = activePage?.parent_id;

    while (parentId && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId);
      parentId = pageById.get(parentId)?.parent_id;
    }

    if (ancestorIds.size === 0) return;
    setExpandedPageIds((current) => {
      const next = new Set(current);
      for (const pageId of ancestorIds) next.add(pageId);
      return next;
    });
  }, [activeSlug, pages]);

  function togglePage(pageId: string) {
    setExpandedPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }

  function renderPages(parentId: string | null): React.ReactNode {
    return (pagesByParent.get(parentId) ?? []).map((page) => {
      const children = pagesByParent.get(page.id) ?? [];
      const hasChildren = children.length > 0;
      const expanded = expandedPageIds.has(page.id);
      const active = activeSlug === page.slug;
      return (
        <li key={page.id}>
          <div className="flex min-h-8 items-stretch">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => togglePage(page.id)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${page.title}`}
                className={cn(
                  "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-8 shrink-0 cursor-pointer items-center justify-center rounded-l-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  active && "bg-surface-selected text-primary",
                )}
              >
                {expanded ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </button>
            ) : (
              <span className="w-8 shrink-0" aria-hidden />
            )}
            <SidebarLink
              href={pageHref(spaceKey, page.slug)}
              active={active}
              className={cn(
                "min-w-0 flex-1 rounded-l-none px-0 pr-2",
                !hasChildren && "rounded-l-md",
              )}
            >
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{page.title}</span>
            </SidebarLink>
          </div>
          {hasChildren && expanded ? (
            <ul className="space-y-0.5 pl-4">
              {renderPages(page.id)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  return <>{renderPages(null)}</>;
}

export function SpaceWorkspace({
  space,
  pages,
  members,
  currentPage,
  initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  canEdit,
}: {
  space: Space;
  pages: WikiPage[];
  members: SpaceMember[];
  currentPage?: WikiPage | null;
  initialSidebarWidth?: number;
  canEdit: boolean;
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
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("normal");
  const [conversionMode, setConversionMode] = useState<EditMode | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewSplit, setPreviewSplit] = useState(50);
  const [viewFullWidth, setViewFullWidth] = useState(true);
  const [viewWidthMenuOpen, setViewWidthMenuOpen] = useState(false);
  const [likeStatus, setLikeStatus] = useState<PageLikeStatus>({ liked_by_me: false, like_count: 0 });
  const [likePending, setLikePending] = useState(false);
  const savedPageKeys = useSyncExternalStore(
    subscribeToSavedPages,
    getSavedPageKeys,
    () => [],
  );
  const [draftContent, setDraftContent] = useState("");
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [savePending, setSavePending] = useState(false);

  const title = currentPage?.title ?? space.name;
  const body = currentPage?.content || space.description;
  const activeSlug = currentPage?.slug ?? null;
  const savedPageKey = currentPage
    ? `${space.key}/${currentPage.slug}`
    : null;
  const savedForLater = savedPageKey ? savedPageKeys.includes(savedPageKey) : false;
  const liked = likeStatus.liked_by_me;
  const author = currentPage?.created_by_username ?? space.created_by_username;
  const updatedBy =
    currentPage?.updated_by_username ?? space.created_by_username;
  const updatedAt = currentPage?.updated_at ?? space.updated_at;
  const breadcrumbPages = useMemo(() => {
    if (!currentPage) return [];

    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const ancestors: WikiPage[] = [];
    const visited = new Set<string>([currentPage.id]);
    let parentId = currentPage.parent_id;

    while (parentId && !visited.has(parentId)) {
      const parent = pagesById.get(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      visited.add(parent.id);
      parentId = parent.parent_id;
    }

    return [...ancestors, currentPage];
  }, [currentPage, pages]);

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

  function toggleSavedForLater() {
    if (!savedPageKey) return;

    const nextKeys = savedForLater
      ? savedPageKeys.filter((key) => key !== savedPageKey)
      : [...savedPageKeys, savedPageKey];
    savePageKeys(nextKeys);
    toast.success(savedForLater ? "Removed from saved pages." : "Page saved for later.");
  }

  async function toggleLiked() {
    if (!currentPage) return;
    setLikePending(true);
    try {
      const action = liked ? api.delete<PageLikeStatus> : api.put<PageLikeStatus>;
      const next = await action(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/like`,
      );
      setLikeStatus(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the like.");
    } finally {
      setLikePending(false);
    }
  }

  useEffect(() => {
    if (!currentPage) return;
    let active = true;
    void api
      .get<PageLikeStatus>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/like`,
      )
      .then((next) => {
        if (active) setLikeStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentPage, space.key]);

  async function shareCurrentPage() {
    const url = window.location.href;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          // Fall back for browsers that expose Clipboard but deny permission.
        }
      }
      if (!copied) {
        const field = document.createElement("textarea");
        field.value = url;
        field.setAttribute("readonly", "");
        field.className = "sr-only";
        document.body.appendChild(field);
        field.select();
        copied = document.execCommand("copy");
        document.body.removeChild(field);
        if (!copied) throw new Error("Clipboard unavailable");
      }
      toast.success("Page link copied to clipboard.");
    } catch {
      toast.error("Could not copy the page link.");
    }
  }

  function openEditor(mode: EditMode) {
    if (!currentPage) return;
    const sourceFormat = currentPage.content_format;
    const markdown =
      sourceFormat === "markdown"
        ? prettyMarkdownEmbeddedHtml(currentPage.content)
        : htmlToMarkdown(currentPage.content);
    const html =
      sourceFormat === "markdown"
        ? markdownToHtml(currentPage.content)
        : currentPage.content;
    setDraftContent(mode === "html" ? prettyHtml(html) : html);
    setMarkdownDraft(markdown);
    setEditMode(mode);
    setPreviewing(false);
    setEditing(true);
  }

  function beginEditing(mode: EditMode) {
    if (!currentPage) return;
    if (currentPage.content_format !== formatForMode(mode)) {
      setConversionMode(mode);
      return;
    }
    openEditor(mode);
  }

  function cancelEditing() {
    setEditing(false);
    setConversionMode(null);
    setDraftContent("");
    setMarkdownDraft("");
    setPreviewing(false);
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPage) return;

    setSavePending(true);
    try {
      const updated = await api.patch<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}`,
        {
          content: editMode === "markdown" ? markdownDraft : draftContent,
          content_format: formatForMode(editMode),
        },
      );
      toast.success(`Saved "${updated.title}".`);
      setEditing(false);
      setPreviewing(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save this page.",
      );
    } finally {
      setSavePending(false);
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
                {space.status === "active" && canEdit ? (
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
                  <PageTree
                    pages={pages}
                    spaceKey={space.key}
                    activeSlug={activeSlug}
                  />
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
        <div
          className={cn(
            "mx-auto px-6 py-5 sm:px-8 lg:px-10",
            editing || viewFullWidth ? "max-w-none" : "max-w-6xl",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Breadcrumb" className="text-sm">
              <Link
                href={`/spaces/${encodeURIComponent(space.key)}`}
                className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Pages
              </Link>
              {breadcrumbPages.map((page, index) => (
                <span key={page.id}>
                  <span className="text-muted-foreground mx-2">/</span>
                  {index === breadcrumbPages.length - 1 ? (
                    <span className="text-muted-foreground">{page.title}</span>
                  ) : (
                    <Link
                      href={pageHref(space.key, page.slug)}
                      className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {page.title}
                    </Link>
                  )}
                </span>
              ))}
            </nav>

            <div className="flex flex-nowrap items-center gap-1">
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPreviewing((current) => !current)}
                    disabled={savePending}
                    aria-pressed={previewing}
                  >
                    {previewing ? <EyeOff /> : <Eye />}
                    {previewing ? "Hide live preview" : "Live preview"}
                  </Button>
                  <Button
                    type="submit"
                    form="page-editor-form"
                    variant="primary"
                    size="sm"
                    disabled={savePending}
                  >
                    <Check />
                    {savePending ? "Saving..." : "Save"}
                  </Button>
                  <span aria-hidden className="bg-border mx-1 h-5 w-px" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelEditing}
                    disabled={savePending}
                  >
                    <X />
                    Cancel
                  </Button>
                </>
              ) : currentPage && canEdit && space.status === "active" ? (
                <>
                  <CreatePageDialog
                    spaceKey={space.key}
                    parentPage={currentPage}
                    triggerLabel="Create"
                    triggerVariant="ghost"
                    triggerSize="sm"
                  />
                  <MovePageDialog
                    space={space}
                    page={currentPage}
                    pages={pages}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={editing}>
                        <Pencil />
                        Edit
                        <ChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuItem onSelect={() => beginEditing("normal")}>
                        <Pencil />
                        Normal editor
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => beginEditing("markdown")}>
                        <FileText />
                        Markdown source
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => beginEditing("html")}>
                        <CodeXml />
                        HTML source
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
              {!editing ? (
                <>
                  <div className="hidden items-center gap-1 lg:flex">
                  {currentPage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSavedForLater}
                      aria-pressed={savedForLater}
                    >
                      <Star className={cn(savedForLater && "fill-current text-primary")} />
                      {savedForLater ? "Saved" : "Save for later"}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="sm" onClick={() => void shareCurrentPage()}>
                    <Share2 />
                    Share
                  </Button>
                  <div
                    className="relative"
                    onBlur={(event) => {
                      const next = event.relatedTarget;
                      if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                        setViewWidthMenuOpen(false);
                      }
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Page width options"
                      aria-haspopup="menu"
                      aria-expanded={viewWidthMenuOpen}
                      title="Page width options"
                      onClick={() => setViewWidthMenuOpen((open) => !open)}
                    >
                      <Maximize2 />
                      View
                      <ChevronDown />
                    </Button>
                    {viewWidthMenuOpen ? (
                      <div
                        role="menu"
                        aria-label="Page width"
                        className="border-border bg-surface absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border p-1 shadow-lg"
                      >
                        <Button
                          type="button"
                          variant="subtle"
                          size="sm"
                          role="menuitemradio"
                          aria-checked={viewFullWidth}
                          className="w-full justify-start"
                          onClick={() => {
                            setViewFullWidth(true);
                            setViewWidthMenuOpen(false);
                          }}
                        >
                          <Maximize2 />
                          Full width
                          {viewFullWidth ? <Check className="text-primary ml-auto" /> : null}
                        </Button>
                        <Button
                          type="button"
                          variant="subtle"
                          size="sm"
                          role="menuitemradio"
                          aria-checked={!viewFullWidth}
                          className="w-full justify-start"
                          onClick={() => {
                            setViewFullWidth(false);
                            setViewWidthMenuOpen(false);
                          }}
                        >
                          <Minimize2 />
                          Normal width
                          {!viewFullWidth ? <Check className="text-primary ml-auto" /> : null}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="More page actions"
                        className="lg:hidden"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48 lg:hidden">
                      {currentPage ? (
                        <DropdownMenuItem onSelect={toggleSavedForLater}>
                          <Star className={cn(savedForLater && "fill-current text-primary")} />
                          {savedForLater ? "Remove from saved" : "Save for later"}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => void shareCurrentPage()}>
                        <Share2 />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setViewFullWidth(true)}>
                        <Maximize2 />
                        Full width
                        {viewFullWidth ? <Check className="text-primary ml-auto" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setViewFullWidth(false)}>
                        <Minimize2 />
                        Normal width
                        {!viewFullWidth ? <Check className="text-primary ml-auto" /> : null}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            </div>
          </div>

          <article
            className={cn(
              "mt-4",
              !editing && !viewFullWidth && "max-w-[var(--wh-content-max)]",
            )}
          >
            {editing && currentPage ? (
              <form
                id="page-editor-form"
                onSubmit={savePage}
                className="space-y-5"
                noValidate
              >
                <h1 className="text-foreground text-3xl font-semibold tracking-normal">
                  {currentPage.title}
                </h1>
                <div
                  className={cn(
                    "min-w-0",
                    previewing && "xl:grid xl:[grid-template-columns:var(--live-preview-columns)]",
                  )}
                  style={
                    previewing
                      ? ({
                          "--live-preview-columns": `minmax(0, ${previewSplit}fr) 12px minmax(0, ${100 - previewSplit}fr)`,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <div className="min-w-0">
                    {editMode === "normal" ? (
                      <RichTextEditor
                        content={draftContent}
                        onChange={setDraftContent}
                      />
                    ) : (
                      <SourceCodeEditor
                        language={editMode}
                        value={editMode === "markdown" ? markdownDraft : draftContent}
                        onChange={(value) => {
                          if (editMode === "markdown") {
                            setMarkdownDraft(value);
                          } else {
                            setDraftContent(value);
                          }
                        }}
                      />
                    )}
                  </div>

                  {previewing ? (
                    <>
                      <button
                        type="button"
                        role="separator"
                        aria-label="Resize editor and live preview panels"
                        aria-orientation="vertical"
                        aria-valuemin={MIN_PREVIEW_SPLIT}
                        aria-valuemax={MAX_PREVIEW_SPLIT}
                        aria-valuenow={previewSplit}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          document.body.style.cursor = "col-resize";
                          document.body.style.userSelect = "none";
                        }}
                        onPointerMove={(event) => {
                          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                          const container = event.currentTarget.parentElement;
                          if (!container) return;
                          const bounds = container.getBoundingClientRect();
                          const next = Math.round(((event.clientX - bounds.left) / bounds.width) * 100);
                          setPreviewSplit(Math.min(MAX_PREVIEW_SPLIT, Math.max(MIN_PREVIEW_SPLIT, next)));
                        }}
                        onPointerUp={(event) => {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                          document.body.style.cursor = "";
                          document.body.style.userSelect = "";
                        }}
                        onPointerCancel={() => {
                          document.body.style.cursor = "";
                          document.body.style.userSelect = "";
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowLeft") {
                            event.preventDefault();
                            setPreviewSplit((current) => Math.max(MIN_PREVIEW_SPLIT, current - 2));
                          }
                          if (event.key === "ArrowRight") {
                            event.preventDefault();
                            setPreviewSplit((current) => Math.min(MAX_PREVIEW_SPLIT, current + 2));
                          }
                          if (event.key === "Home") {
                            event.preventDefault();
                            setPreviewSplit(MIN_PREVIEW_SPLIT);
                          }
                          if (event.key === "End") {
                            event.preventDefault();
                            setPreviewSplit(MAX_PREVIEW_SPLIT);
                          }
                        }}
                        className="group relative hidden cursor-col-resize touch-none select-none items-stretch justify-center outline-none xl:flex focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className="bg-border group-hover:bg-border-strong group-active:bg-primary h-full w-px transition-colors duration-150" />
                        <span
                          aria-hidden
                          className="border-border-strong bg-surface-raised text-muted-foreground group-hover:border-primary group-hover:text-primary group-active:bg-primary group-active:text-primary-foreground absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded border text-xs font-semibold shadow-sm transition-[color,background-color,border-color] duration-150"
                        >
                          ⋮
                        </span>
                      </button>

                      <div className="mt-6 min-w-0 xl:mt-0 xl:flex">
                      <section
                        aria-label="Live page preview"
                        className="border-border bg-surface-raised min-w-0 rounded-md border shadow-sm xl:h-full xl:flex-1"
                      >
                        <div className="border-border bg-surface-sunken flex items-center gap-2 border-b px-4 py-2.5">
                          <Eye className="text-primary size-4" aria-hidden />
                          <p className="text-xs font-semibold tracking-wide uppercase">Live preview</p>
                          <span className="text-muted-foreground ml-auto text-xs">
                            Updates as you type
                          </span>
                        </div>
                        <div className="p-5">
                          {(editMode === "markdown" ? markdownDraft : draftContent) ? (
                            editMode === "markdown" ? (
                              <MarkdownContent content={markdownDraft} />
                            ) : (
                              <RichTextContent content={draftContent} />
                            )
                          ) : (
                            <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
                          )}
                        </div>
                      </section>
                      </div>
                    </>
                  ) : null}
                </div>
              </form>
            ) : (
              <>
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
                    onClick={toggleLiked}
                    disabled={!currentPage || likePending}
                    aria-pressed={liked}
                    className={cn(
                      "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                      liked
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ThumbsUp className={cn("size-4", liked && "fill-current")} />
                    {liked ? "Liked" : "Like"}
                    {likeStatus.like_count > 0 ? `(${likeStatus.like_count})` : null}
                  </button>
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    No labels
                    <Tag className="size-3.5" />
                  </span>
                </div>

                <div
                  className="mt-8 min-h-64"
                >
                  {body ? (
                    currentPage?.content_format === "markdown" ? (
                      <MarkdownContent content={body} />
                    ) : (
                      <RichTextContent content={body} />
                    )
                  ) : (
                    <div className="border-border bg-surface-sunken rounded-lg border border-dashed p-6">
                      <p className="font-medium">No content yet</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Select Edit to start writing this page.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </article>

          <ConfirmDialog
            open={conversionMode !== null}
            onOpenChange={(open) => {
              if (!open) setConversionMode(null);
            }}
            title={
              conversionMode === "markdown"
                ? "Convert this page to Markdown?"
                : "Convert this page to HTML?"
            }
            description={
              conversionMode === "markdown"
                ? "Markdown cannot represent every rich-text feature, including text colours, cell backgrounds and merged table cells. To preserve them, WikiHub will embed their HTML directly in the Markdown source. The resulting document will not be pure Markdown."
                : "This changes the page source from Markdown to HTML. Its current Markdown source will be converted when you save."
            }
            confirmLabel="Continue"
            onConfirm={() => {
              if (!conversionMode) return;
              const mode = conversionMode;
              setConversionMode(null);
              openEditor(mode);
            }}
          />

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

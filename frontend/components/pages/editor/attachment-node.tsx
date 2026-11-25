"use client";

import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import {
  Info,
  Link2,
  Paperclip,
  Presentation,
  Type,
  Trash2,
  FileText,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileVideo,
  File as FileIcon,
  Download,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { TOGGLE_ON_CLASS } from "./content-normalize";

/** Matches the URL shape the API hands out for a stored attachment. */
const ATTACHMENT_HREF = /\/api\/v1\/attachments\/[a-f0-9-]{36}/i;

/**
 * Attachment links never navigate: a capture listener turns a click on one
 * into the preview modal. Anything guarding real navigation has to know that,
 * or it will challenge a click that was only ever going to open a dialog.
 */
export function isAttachmentHref(href: string) {
  return ATTACHMENT_HREF.test(href);
}

/**
 * The attachment a link points at, or null for anything else.
 *
 * While a page is being edited the tile carries no href at all - see
 * AttachmentTile for why - so the target is read from a data attribute too.
 */
export function attachmentIdFromLink(link: Element) {
  const attr = (name: string) => link.getAttribute(name);
  const target = attr("href") || attr("data-attachment-href") || "";
  return target.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i)?.[1] ?? null;
}
/** A trailing ".ext" is what separates a filename from ordinary link prose. */
const FILENAME_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

// Elements rather than component references: building a component during a
// render is what react-hooks/static-components warns about, and an element
// created once at module scope is reusable as-is.
const ATTACHMENT_ICON_CLASS = "size-7";
const ATTACHMENT_ICONS: [RegExp, ReactNode][] = [
  [
    /\.(zip|jar|war|ear|tar|gz|tgz|bz2|xz|7z|rar)$/i,
    <FileArchive className={ATTACHMENT_ICON_CLASS} aria-hidden key="archive" />,
  ],
  [
    /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i,
    <FileImage className={ATTACHMENT_ICON_CLASS} aria-hidden key="image" />,
  ],
  [
    /\.(mp4|mov|avi|mkv|webm|wmv|flv)$/i,
    <FileVideo className={ATTACHMENT_ICON_CLASS} aria-hidden key="video" />,
  ],
  [
    /\.(mp3|wav|flac|ogg|m4a|aac)$/i,
    <FileAudio className={ATTACHMENT_ICON_CLASS} aria-hidden key="audio" />,
  ],
  [
    /\.(csv|xlsx?|xlsm|ods)$/i,
    <FileSpreadsheet
      className={ATTACHMENT_ICON_CLASS}
      aria-hidden
      key="sheet"
    />,
  ],
  [
    /\.(pptx?|ppsx?|key|odp)$/i,
    <Presentation
      className={ATTACHMENT_ICON_CLASS}
      aria-hidden
      key="presentation"
    />,
  ],
  [
    /\.(ya?ml|json|xml|toml|ini|conf|properties|sh|bash|ps1|sql|py|java|go|rs|ts|tsx|js|jsx|css|html?)$/i,
    <FileCode className={ATTACHMENT_ICON_CLASS} aria-hidden key="code" />,
  ],
  [
    /\.(pdf|docx?|odt|rtf|txt|md|log)$/i,
    <FileText className={ATTACHMENT_ICON_CLASS} aria-hidden key="text" />,
  ],
];
const GENERIC_ATTACHMENT_ICON = (
  <FileIcon className={ATTACHMENT_ICON_CLASS} aria-hidden />
);

export function attachmentIcon(filename: string) {
  const match = ATTACHMENT_ICONS.find(([pattern]) => pattern.test(filename));
  return match ? match[1] : GENERIC_ATTACHMENT_ICON;
}

/**
 * A Confluence-style attachment tile. The <a> is kept as the innermost
 * clickable element on purpose: the capture listeners that open the preview
 * modal find their target with `closest("a")`, so the tile inherits that
 * behaviour in the editor and on a saved page alike.
 */
function AttachmentTile({
  node,
  getPos,
  selected,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const filename = String(node.attrs.filename ?? "attachment");
  const href = String(node.attrs.href ?? "");
  const displayMode = String(node.attrs.displayMode ?? "card");
  const diffKind = String(node.attrs.diffKind ?? "");
  const caption = String(node.attrs.caption ?? "");
  const [hovered, setHovered] = useState(false);
  const [toolbarBelow, setToolbarBelow] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const attachmentRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const icon = attachmentIcon(filename);
  const { t } = useTranslation();

  const isUploading = Boolean(node.attrs.uploading);
  const isCard = displayMode !== "link";
  const showToolbar =
    editor.isEditable && (selected || hovered) && !isUploading;

  function saveAttachmentCaption() {
    updateAttributes({ caption: captionDraft.trim() });
    setCaptionOpen(false);
  }

  const keepToolsVisible = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    const attachment = attachmentRef.current;
    const editorSurface = attachment?.closest(".ProseMirror");
    if (attachment && editorSurface) {
      // EditorContent scrolls horizontally for wide tables. That surface clips
      // an attachment menu rendered above the first row, so flip it below the
      // tile when there is not enough room above it.
      const attachmentTop = attachment.getBoundingClientRect().top;
      const editorTop = editorSurface.getBoundingClientRect().top;
      setToolbarBelow(attachmentTop - editorTop < 52);
    }
    setHovered(true);
  }, []);

  const scheduleToolsHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHovered(false), 50);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  function handleSelectNode(e?: React.MouseEvent) {
    if (!editor.isEditable || isUploading) return;
    e?.preventDefault();
    e?.stopPropagation();
    if (typeof getPos === "function") {
      const pos = getPos();
      if (typeof pos === "number") {
        editor.commands.setNodeSelection(pos);
      }
    }
  }

  // Same machinery images use. Tiptap's node view hides dragstart from
  // ProseMirror, so the editor's own handleDrop has to be told which node is
  // moving; without this the tile would be copied on drop, not moved.
  function beginMove(event: React.DragEvent<HTMLElement>) {
    if (!editor.isEditable || isUploading) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos: typeof getPos === "function" ? getPos() : undefined },
      }),
    );
  }

  function endMove(event: React.DragEvent<HTMLElement>) {
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  }

  function handleOpenDetails(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i)?.[1];
    if (match) {
      const event = new CustomEvent("wikihub:open-attachment-modal", {
        bubbles: true,
        detail: { attachmentId: match },
      });
      window.dispatchEvent(event);
    }
  }

  const floatingToolbar = showToolbar ? (
    <div
      className={cn(
        "border-border bg-surface-raised animate-in fade-in zoom-in-95 absolute left-0 z-50 flex min-w-max items-center gap-1 rounded-lg border p-1 text-xs whitespace-nowrap shadow-lg duration-100 select-none",
        toolbarBelow
          ? "top-full mt-1.5 before:absolute before:right-0 before:bottom-full before:left-0 before:h-2 before:content-['']"
          : "bottom-full mb-1.5 after:absolute after:top-full after:right-0 after:left-0 after:h-2 after:content-['']",
      )}
      contentEditable={false}
      onMouseEnter={keepToolsVisible}
      onMouseLeave={scheduleToolsHide}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-surface-sunken/80 border-border/50 flex items-center rounded-md border p-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateAttributes({ displayMode: "card" });
          }}
          className={cn(
            "focus-visible:ring-ring flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
            isCard
              ? "bg-primary text-primary-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-raised",
          )}
          title={t("editor.displayAsCard")}
        >
          <LayoutGrid className="size-3" />
          <span>{t("editor.card")}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateAttributes({ displayMode: "link" });
          }}
          className={cn(
            "focus-visible:ring-ring flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
            !isCard
              ? "bg-primary text-primary-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-raised",
          )}
          title={t("editor.displayAsLink")}
        >
          <Link2 className="size-3" />
          <span>{t("editor.link")}</span>
        </button>
      </div>

      <div className="bg-border mx-0.5 h-3.5 w-px" />

      <button
        type="button"
        onClick={handleOpenDetails}
        className="text-muted-foreground hover:text-foreground hover:bg-surface-sunken focus-visible:ring-ring cursor-pointer rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        title={t("editor.viewFileDetails")}
      >
        <Info className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCaptionDraft(caption);
          setCaptionOpen(true);
        }}
        aria-label={t("editor.attachmentCaption")}
        title={t("editor.attachmentCaption")}
        aria-pressed={Boolean(caption)}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-surface-sunken focus-visible:ring-ring cursor-pointer rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none",
          caption && TOGGLE_ON_CLASS,
        )}
      >
        <Type className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const a = document.createElement("a");
          a.href = href;
          a.download = filename;
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }}
        className="text-muted-foreground hover:text-foreground hover:bg-surface-sunken focus-visible:ring-ring flex cursor-pointer items-center justify-center rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        title={t("editor.downloadFile")}
      >
        <Download className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          deleteNode();
        }}
        className="focus-visible:ring-ring cursor-pointer rounded p-1 text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:ring-2 focus-visible:outline-none dark:text-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300"
        title={t("editor.removeAttachment")}
      >
        <Trash2 className="size-3.5 text-red-500 dark:text-red-400" />
      </button>
    </div>
  ) : null;

  const attachmentCaptionDialog = (
    <Dialog open={captionOpen} onOpenChange={setCaptionOpen}>
      <DialogContent
        title={t("editor.attachmentCaption")}
        className="max-w-md"
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="attachment-caption">
            {t("editor.caption")}
          </label>
          <Input
            id="attachment-caption"
            value={captionDraft}
            onChange={(event) => setCaptionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveAttachmentCaption();
              }
            }}
            placeholder={t("editor.attachmentCaptionPlaceholder")}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCaptionOpen(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={saveAttachmentCaption}>
            {t("editor.saveCaption")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!isCard) {
    return (
      <NodeViewWrapper
        as="span"
        ref={attachmentRef}
        className={cn(
          "group/attachment-wrapper relative my-0.5 inline-block px-1 py-0.5 align-baseline",
          isUploading && "pointer-events-none select-none",
        )}
        onDragStartCapture={
          isUploading
            ? (e: React.DragEvent<HTMLElement>) => e.preventDefault()
            : beginMove
        }
        onDragEndCapture={isUploading ? undefined : endMove}
        onMouseEnter={isUploading ? undefined : keepToolsVisible}
        onMouseLeave={isUploading ? undefined : scheduleToolsHide}
      >
        {floatingToolbar}
        {attachmentCaptionDialog}
        <a
          href={isUploading || editor.isEditable ? undefined : href}
          data-attachment-href={href || undefined}
          data-diff-kind={diffKind || undefined}
          data-display-mode="link"
          data-caption={caption || undefined}
          data-uploading={isUploading ? "true" : undefined}
          title={filename}
          target="_self"
          role={editor.isEditable && !isUploading ? "button" : undefined}
          tabIndex={editor.isEditable && !isUploading ? 0 : undefined}
          onClick={isUploading ? undefined : handleSelectNode}
          onKeyDown={(event) => {
            if (!editor.isEditable || isUploading) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSelectNode();
            }
          }}
          contentEditable={false}
          draggable={editor.isEditable && !isUploading}
          aria-busy={isUploading || undefined}
          className={cn(
            "attachment-link text-primary inline-flex items-center gap-1 align-baseline text-xs font-medium",
            isUploading
              ? "cursor-wait opacity-80"
              : [
                  "hover:underline",
                  editor.isEditable
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-pointer",
                  selected && "outline-primary/40 outline outline-2",
                  diffKind === "add" && "bg-success-bg text-success",
                  diffKind === "delete" && "bg-danger-bg text-danger line-through",
                ],
          )}
        >
          <span className="text-muted-foreground flex size-3.5 shrink-0 items-center justify-center">
            {isUploading ? (
              <Loader2 className="text-primary size-3 animate-spin" />
            ) : (
              <Paperclip className="size-3" />
            )}
          </span>
          <span className="max-w-[260px] truncate">{filename}</span>
          {isUploading ? (
            <span className="text-muted-foreground text-[10px] italic">
              ({t("editor.importingAttachment")})
            </span>
          ) : null}
        </a>
        {!isUploading && caption ? (
          <span
            className={cn(
              "text-muted-foreground ml-1.5 text-[11px] italic",
              editor.isEditable && "hover:text-foreground cursor-pointer transition-colors",
            )}
            title={caption}
            onClick={
              editor.isEditable
                ? (e) => {
                    e.stopPropagation();
                    setCaptionDraft(caption);
                    setCaptionOpen(true);
                  }
                : undefined
            }
          >
            ({caption})
          </span>
        ) : null}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      ref={attachmentRef}
      className={cn(
        "group/attachment-wrapper relative mx-0.5 my-1 inline-block px-1.5 py-0.5 align-top",
        isUploading && "pointer-events-none select-none",
      )}
      onDragStartCapture={
        isUploading
          ? (e: React.DragEvent<HTMLElement>) => e.preventDefault()
          : beginMove
      }
      onDragEndCapture={isUploading ? undefined : endMove}
      onMouseEnter={isUploading ? undefined : keepToolsVisible}
      onMouseLeave={isUploading ? undefined : scheduleToolsHide}
    >
      {floatingToolbar}
      {attachmentCaptionDialog}
      <a
        href={isUploading || editor.isEditable ? undefined : href}
        data-attachment-href={href || undefined}
        data-diff-kind={diffKind || undefined}
        data-display-mode="card"
        data-caption={caption || undefined}
        data-uploading={isUploading ? "true" : undefined}
        title={filename}
        target="_self"
        role={editor.isEditable && !isUploading ? "button" : undefined}
        tabIndex={editor.isEditable && !isUploading ? 0 : undefined}
        onClick={isUploading ? undefined : handleSelectNode}
        onKeyDown={(event) => {
          if (!editor.isEditable || isUploading) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSelectNode();
          }
        }}
        contentEditable={false}
        draggable={editor.isEditable && !isUploading}
        aria-busy={isUploading || undefined}
        className={cn(
          "group/attachment border-border bg-surface-raised flex w-28 flex-col items-center gap-1.5 rounded-md border p-2 !no-underline shadow-sm transition-colors sm:w-32",
          isUploading
            ? "border-primary/40 bg-surface-raised/90 cursor-wait animate-pulse"
            : [
                "hover:border-primary focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                editor.isEditable
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-pointer",
                selected && "border-primary ring-primary/40 ring-2",
                diffKind === "add" && "border-success bg-success-bg/60",
                diffKind === "delete" && "border-danger bg-danger-bg/60",
              ],
        )}
      >
        <span className="bg-surface-sunken text-muted-foreground group-hover/attachment:text-primary relative flex h-16 w-full items-center justify-center overflow-hidden rounded p-1 transition-colors">
          {isUploading ? (
            <div className="flex flex-col items-center justify-center gap-1">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename) && href ? (
            <img
              src={href}
              alt={filename}
              className="h-full w-full rounded object-contain"
            />
          ) : (
            icon
          )}
        </span>
        <span
          className="text-foreground w-full truncate text-center text-[11px] leading-tight"
          title={filename}
        >
          {filename}
        </span>
        {isUploading ? (
          <span className="text-muted-foreground flex items-center justify-center gap-1 text-[10px] leading-none">
            <span className="bg-primary size-1.5 rounded-full animate-pulse" />
            {t("editor.importingAttachment")}
          </span>
        ) : null}
      </a>
      {!isUploading && caption ? (
        <span
          className={cn(
            "text-muted-foreground mt-1 block max-w-[16rem] truncate text-center text-xs italic",
            editor.isEditable && "hover:text-foreground cursor-pointer transition-colors",
          )}
          title={caption}
          onClick={
            editor.isEditable
              ? (e) => {
                  e.stopPropagation();
                  setCaptionDraft(caption);
                  setCaptionOpen(true);
                }
              : undefined
          }
        >
          {caption}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

export const AttachmentNode = TiptapNode.create({
  name: "attachment",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("href"),
      },
      filename: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-attachment") ||
          element.textContent?.trim() ||
          "attachment",
      },
      displayMode: {
        default: "card",
        parseHTML: (element) =>
          element.getAttribute("data-display-mode") ||
          (element.classList.contains("attachment-link")
            ? "link"
            : element.getAttribute("data-attachment")
              ? "card"
              : "link"),
      },
      diffKind: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-diff-kind"),
      },
      caption: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-caption") ?? "",
      },
      uploading: {
        default: false,
      },
      uploadId: {
        default: null,
      },
    };
  },

  parseHTML() {
    // Priority has to clear the Link mark's, or an attachment would be parsed
    // as ordinary linked text before this rule is ever consulted.
    return [
      {
        tag: "a[data-attachment]",
        priority: 1100,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const displayAttr = el.getAttribute("data-display-mode");
          const isExplicitLink =
            displayAttr === "link" || el.classList.contains("attachment-link");
          let filename =
            el.getAttribute("data-attachment") ||
            el.getAttribute("title") ||
            el.textContent?.trim() ||
            "attachment";
          if (filename.toLowerCase() === "download") {
            const titleVal = el.getAttribute("title");
            const downloadAttr = el.getAttribute("download");
            if (titleVal && titleVal.toLowerCase() !== "download") {
              filename = titleVal;
            } else if (
              downloadAttr &&
              downloadAttr.toLowerCase() !== "download"
            ) {
              filename = downloadAttr;
            }
          }
          return {
            href: el.getAttribute("href"),
            filename,
            displayMode: isExplicitLink ? "link" : "card",
            diffKind: el.getAttribute("data-diff-kind"),
            caption: el.getAttribute("data-caption") ?? "",
          };
        },
      },
      {
        // Pages written before this node existed carry no data-attachment marker.
        // Recognize them by href. Standard inline links default to link mode.
        tag: "a[href]",
        priority: 1100,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const href = el.getAttribute("href") ?? "";
          if (!ATTACHMENT_HREF.test(href)) return false;
          const text = el.textContent?.trim() ?? "";
          if (!FILENAME_EXTENSION.test(text)) return false;
          const displayAttr = el.getAttribute("data-display-mode");
          return {
            href,
            filename: text,
            displayMode: displayAttr === "card" ? "card" : "link",
            diffKind: el.getAttribute("data-diff-kind"),
            caption: el.getAttribute("data-caption") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const filename = String(node.attrs.filename ?? "attachment");
    const displayMode = String(node.attrs.displayMode ?? "card");
    const caption = String(node.attrs.caption ?? "").trim();
    const uploading = Boolean(node.attrs.uploading);
    return [
      "a",
      mergeAttributes({
        href: node.attrs.href || undefined,
        title: filename,
        target: "_self",
        "data-attachment": filename,
        "data-display-mode": displayMode,
        "data-diff-kind": node.attrs.diffKind || undefined,
        "data-caption": caption || undefined,
        "data-uploading": uploading ? "true" : undefined,
        class:
          displayMode === "link"
            ? "attachment-link inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs align-baseline"
            : undefined,
      }),
      filename,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentTile);
  },
});

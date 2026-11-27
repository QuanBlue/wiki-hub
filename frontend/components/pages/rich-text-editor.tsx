"use client";

import { NodeSelection } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import { dropPoint } from "@tiptap/pm/transform";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { WritingAssistant } from "@/components/pages/writing-assistant";
import type { WikiPage } from "@/types/api";

import { AttachmentDetailsModal } from "./editor/attachment-details-modal";
import { attachmentIdFromLink, isAttachmentHref } from "./editor/attachment-node";
import {
  DRAGGABLE_NODE_TYPES,
  editorClassName,
  ignoreNodeViewChrome,
  linkifyPlainTextUrls,
  normalizeConfluenceCodeMacros,
  readerClassName,
} from "./editor/content-normalize";
import {
  buildEditorExtensions,
  readOnlyEditorExtensions,
} from "./editor/extensions";
import {
  LinkFloatingToolbar,
  TableActionsMenu,
} from "./editor/floating-menus";
import {
  ImageContextMenu,
  type ImageContextMenuState,
} from "./editor/image-context-menu";
import { ImageLightbox } from "./editor/image-lightbox";
import { RichTextToolbar } from "./editor/rich-text-toolbar";
import { TABLE_COLUMN_HOVER_KEY } from "./editor/table-extensions";

export {
  ignoreNodeViewChrome,
  isAttachmentHref,
  linkifyPlainTextUrls,
  normalizeConfluenceCodeMacros,
  readerClassName,
  readOnlyEditorExtensions,
};

export function RichTextEditor({
  content,
  onChange,
  onUploadFile,
  pageLinkContext,
  onSubpageCreated,
}: {
  content: string;
  onChange: (html: string) => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
  // Powers the slash menu's "Link to page" (search + insert a link to an
  // existing page in this space) and "Create sub-page" (create one under
  // currentPageId, insert a link to it, then hand off to onSubpageCreated)
  // items. Omit both on editors with no real page to search/parent to (the
  // space overview editor) - those two menu items then simply do nothing.
  pageLinkContext?: { spaceKey: string; currentPageId: string | null };
  onSubpageCreated?: (page: WikiPage) => void;
}) {
  const [wrapText, setWrapText] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleViewDetails = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setSelectedAttachmentId(id);
    };
    document.addEventListener("wikihub:view-file-details", handleViewDetails);
    return () => {
      document.removeEventListener(
        "wikihub:view-file-details",
        handleViewDetails,
      );
    };
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    // Intercept attachment link clicks at the lowest DOM level possible.
    // We must stop both mousedown AND click events because ProseMirror
    // consumes mousedown and may prevent the click event from firing,
    // while the browser can still follow an <a> link via the mouseup/click
    // sequence if we only intercept one. stopImmediatePropagation() ensures
    // no other capture-phase listener (including ProseMirror's own) sees
    // these events for attachment links.
    const interceptAttachmentLink = (
      event: MouseEvent,
      onMatch: (id: string) => void,
    ) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(id);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        pendingId = id;
        // Preventing the default here would also stop the browser starting a
        // drag, so a draggable tile is left alone. It carries no href, so
        // there is nothing for the browser to navigate to anyway.
        if (!link.draggable) event.preventDefault();
      }
    };

    const handleClick = (event: MouseEvent) => {
      interceptAttachmentLink(event, (id) => {
        setSelectedAttachmentId(id);
        pendingId = null;
      });
      // If mousedown was intercepted but click wasn't (ProseMirror ate it),
      // open the modal using the id captured on mousedown.
      if (pendingId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedAttachmentId(pendingId);
        pendingId = null;
      }
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("click", handleClick, true);
    };
  }, []);
  const internalNodeDragRef = useRef(false);
  const draggedNodePosRef = useRef<number | null>(null);
  const normalizedContent = useMemo(
    () => normalizeConfluenceCodeMacros(content),
    [content],
  );
  const lastEmittedHtml = useRef(normalizedContent);
  const emitEditorContent = useCallback(
    (updatedEditor: Editor) => {
      const nextHtml = updatedEditor.getHTML();
      if (nextHtml === lastEmittedHtml.current) return;
      lastEmittedHtml.current = nextHtml;
      onChange(nextHtml);
    },
    [onChange],
  );
  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildEditorExtensions({
      // The empty-line hint is drawn by EmptyLineHint (with the keys in code type).
      placeholder: "",
    }),
    content: normalizedContent,
    editorProps: {
      attributes: { class: editorClassName },
      handlePaste(view, event) {
        // A screenshot or copied image arrives as a file on the clipboard with
        // no text. Route it through the toolbar's upload path so it is stored
        // as an attachment rather than inlined or dropped. Rich content that
        // merely carries an image alongside text (Word, Excel) keeps ProseMirror's
        // default HTML paste.
        const data = event.clipboardData;
        if (!data) return false;
        const images = Array.from(data.files).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (images.length === 0) return false;
        const html = data.getData("text/html");
        const hasText =
          data.getData("text/plain").trim() !== "" &&
          !/^\s*(<[^>]+>\s*)*<img\b[^>]*>\s*(<[^>]+>\s*)*$/i.test(html);
        if (hasText) return false;
        event.preventDefault();
        view.dom.dispatchEvent(
          new CustomEvent<File[]>("wikihub:editor-files", { detail: images }),
        );
        return true;
      },
      handleDrop(view, event) {
        // Tiptap's default node view `stopEvent` hides `dragstart` from
        // ProseMirror whenever the drag begins on a child of the wrapper - the
        // <img> or the tile's <a> here - so `view.dragging` is never set. Left
        // to its default, ProseMirror then treats the drop as an external one:
        // it pastes a copy parsed from the drag's text/html and never deletes
        // the source, which is what left a duplicate behind. Own the drop
        // instead and move the node ourselves.
        if (!internalNodeDragRef.current) return false;
        const fromPos = draggedNodePosRef.current;
        internalNodeDragRef.current = false;
        draggedNodePosRef.current = null;
        // Every path below returns true, which makes ProseMirror call
        // preventDefault: a drop we cannot place must be a no-op, never a copy.
        if (typeof fromPos !== "number") return true;
        const node = view.state.doc.nodeAt(fromPos);
        if (!node || !DRAGGABLE_NODE_TYPES.has(node.type.name)) return true;
        const dropCoords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!dropCoords) return true;
        const targetPos = dropCoords.pos;
        // Dropped back onto itself: nothing to do.
        if (targetPos >= fromPos && targetPos <= fromPos + node.nodeSize)
          return true;

        const tr = view.state.tr;
        tr.delete(fromPos, fromPos + node.nodeSize);
        const mappedTargetPos = tr.mapping.map(targetPos);
        // A raw text position is not always a place a block image may live -
        // mid-paragraph, for one. dropPoint finds the nearest spot that fits.
        const imageSlice = new Slice(Fragment.from(node), 0, 0);
        const insertPos =
          dropPoint(tr.doc, mappedTargetPos, imageSlice) ?? mappedTargetPos;
        tr.insert(insertPos, node);
        const inserted = tr.doc.nodeAt(insertPos);
        if (inserted && NodeSelection.isSelectable(inserted))
          tr.setSelection(NodeSelection.create(tr.doc, insertPos));
        view.dispatch(tr);
        return true;
      },
    },
    // Round-tripping the stored HTML through the schema rewrites it a little -
    // attribute order, rel on links, the marker on an attachment tile - so the
    // editor's own serialisation rarely matches the string the page was loaded
    // with. Seeding the baseline from the editor means that difference is not
    // mistaken for an edit: without this the first transaction of any kind,
    // even just selecting a node, reported a change and armed the
    // unsaved-changes guard on a page nobody had touched.
    onCreate: ({ editor: createdEditor }) => {
      lastEmittedHtml.current = createdEditor.getHTML();
    },
    onUpdate: ({ editor: updatedEditor }) => emitEditorContent(updatedEditor),
    onTransaction: ({ editor: updatedEditor, transaction }) => {
      if (transaction.getMeta(TABLE_COLUMN_HOVER_KEY)) return;
      emitEditorContent(updatedEditor);
    },
  });

  const handleDroppedFiles = useCallback(
    async (files: FileList) => {
      if (!editor || files.length === 0) return;
      // Let the toolbar own upload state and behaviour by opening its hidden
      // native picker path only for user-selected files; drops call the same
      // backend contract through this custom event.
      const dropEvent = new CustomEvent<File[]>("wikihub:editor-files", {
        detail: Array.from(files),
      });
      editor.view.dom.dispatchEvent(dropEvent);
    },
    [editor],
  );

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (isFileDrag(event) && !internalNodeDragRef.current)
        setDraggingFiles(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (internalNodeDragRef.current) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        return;
      }
      if (!isFileDrag(event)) return;
      // This must run in native capture phase. ProseMirror consumes bubbling
      // events, and without preventDefault Chrome navigates to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDraggingFiles(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        container.contains(event.relatedTarget)
      )
        return;
      setDraggingFiles(false);
    };
    const onDrop = (event: DragEvent) => {
      if (internalNodeDragRef.current) {
        // Only the overlay is cleared here. This listener runs in the capture
        // phase, ahead of ProseMirror's own drop handler, so resetting the drag
        // refs would leave `handleDrop` above blind to the move in flight and
        // the image would be copied instead of moved. Calling preventDefault
        // would be just as bad: ProseMirror skips events whose default is
        // already prevented. onDropCleanup below settles the refs afterwards.
        setDraggingFiles(false);
        return;
      }
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setDraggingFiles(false);
      const position = editor?.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (position) editor?.commands.setTextSelection(position.pos);
      void handleDroppedFiles(event.dataTransfer.files);
    };
    const onInternalNodeDragStart = (event: Event) => {
      internalNodeDragRef.current = true;
      const customEvt = event as CustomEvent<{ pos?: number }>;
      if (typeof customEvt.detail?.pos === "number") {
        draggedNodePosRef.current = customEvt.detail.pos;
      }
      setDraggingFiles(false);
    };
    const onInternalNodeDragEnd = () => {
      internalNodeDragRef.current = false;
      draggedNodePosRef.current = null;
      setDraggingFiles(false);
    };
    // Bubble phase, so it settles the refs only after ProseMirror's drop
    // handler has had them. The node view's own dragend cannot be relied on:
    // a successful move re-creates it, and the detached element may never see
    // the event.
    const onDropCleanup = () => {
      internalNodeDragRef.current = false;
      draggedNodePosRef.current = null;
      setDraggingFiles(false);
    };

    container.addEventListener("dragenter", onDragEnter, true);
    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("dragleave", onDragLeave, true);
    container.addEventListener("drop", onDrop, true);
    container.addEventListener("drop", onDropCleanup);
    container.addEventListener(
      "wikihub:internal-node-drag-start",
      onInternalNodeDragStart,
    );
    container.addEventListener(
      "wikihub:internal-node-drag-end",
      onInternalNodeDragEnd,
    );
    const onOpenAttachmentModal = (event: Event) => {
      const customEvt = event as CustomEvent<{ attachmentId?: string }>;
      if (customEvt.detail?.attachmentId) {
        setSelectedAttachmentId(customEvt.detail.attachmentId);
      }
    };
    window.addEventListener(
      "wikihub:open-attachment-modal",
      onOpenAttachmentModal,
    );

    return () => {
      window.removeEventListener(
        "wikihub:open-attachment-modal",
        onOpenAttachmentModal,
      );
      container.removeEventListener("dragenter", onDragEnter, true);
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("dragleave", onDragLeave, true);
      container.removeEventListener("drop", onDrop, true);
      container.removeEventListener("drop", onDropCleanup);
      container.removeEventListener(
        "wikihub:internal-node-drag-start",
        onInternalNodeDragStart,
      );
      container.removeEventListener(
        "wikihub:internal-node-drag-end",
        onInternalNodeDragEnd,
      );
    };
  }, [editor, handleDroppedFiles]);

  return (
    <div ref={editorContainerRef} className="relative">
      {editor ? (
        <RichTextToolbar
          editor={editor}
          wrapText={wrapText}
          onToggleWrap={() => setWrapText((current) => !current)}
          onUploadFile={onUploadFile}
          pageLinkContext={pageLinkContext}
          onSubpageCreated={onSubpageCreated}
        />
      ) : (
        <div
          className="border-border bg-surface-sunken top-topbar sticky z-20 h-10 rounded-t-md border shadow-xs md:top-0"
          aria-hidden
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          "border-border bg-surface focus-within:ring-ring focus-within:ring-offset-background max-w-full min-w-0 overflow-x-auto rounded-b-md border border-t-0 focus-within:ring-2 focus-within:ring-offset-2",
          !wrapText &&
            "[&_h1]:whitespace-nowrap [&_h2]:whitespace-nowrap [&_h3]:whitespace-nowrap [&_h4]:whitespace-nowrap [&_p]:whitespace-nowrap",
        )}
      />
      <TableActionsMenu editor={editor} />
      {editor && pageLinkContext ? (
        <WritingAssistant editor={editor} spaceKey={pageLinkContext.spaceKey} />
      ) : null}
      <LinkFloatingToolbar
        editor={editor}
        onEditLink={(linkData) =>
          window.dispatchEvent(
            new CustomEvent("wikihub:open-link-dialog", { detail: linkData }),
          )
        }
      />
      {draggingFiles ? (
        <div className="border-primary bg-primary-subtle/90 text-primary pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed text-sm font-semibold">
          Drop images or files to upload
        </div>
      ) : null}
      <AttachmentDetailsModal
        // Keying on the attachment makes each one a fresh mount, so the modal
        // never has to reset its own state on the way out.
        key={selectedAttachmentId ?? "none"}
        attachmentId={selectedAttachmentId}
        canEditOffice
        onClose={() => setSelectedAttachmentId(null)}
      />
    </div>
  );
}

export function RichTextContent({
  content,
  exportMode = false,
  canEditAttachments = false,
  onReady,
}: {
  content: string;
  /**
   * Whether an Office attachment opened from this page may be edited in place.
   * The reader has no editing session of its own, so the page says who may.
   */
  canEditAttachments?: boolean;
  /**
   * Rendering for a static export snapshot (PDF/HTML/Word), not the live
   * screen. Skips attachment click handling and the details modal - both
   * assume a session, which the headless-browser export render never has.
   */
  exportMode?: boolean;
  /** Fires once the editor has mounted content, so an export capture knows
   * when there's something worth reading. */
  onReady?: () => void;
}) {
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const [zoomImage, setZoomImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [imageContextMenu, setImageContextMenu] =
    useState<ImageContextMenuState | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const normalizedContent = useMemo(
    () => linkifyPlainTextUrls(normalizeConfluenceCodeMacros(content)),
    [content],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: readOnlyEditorExtensions,
    content: normalizedContent,
    editorProps: {
      attributes: {
        class: cn(readerClassName, "min-h-0 px-0 py-0"),
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(normalizedContent, { emitUpdate: false });
    }
  }, [editor, normalizedContent]);

  useEffect(() => {
    if (editor && onReady) onReady();
  }, [editor, onReady]);

  useEffect(() => {
    if (exportMode) return;
    const container = editorContainerRef.current;
    if (!container) return;

    const interceptAttachmentLink = (
      event: MouseEvent,
      onMatch: (id: string) => void,
    ) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(id);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        pendingId = id;
      }
    };

    const handleClick = (event: MouseEvent) => {
      interceptAttachmentLink(event, (id) => {
        setSelectedAttachmentId(id);
        pendingId = null;
      });
      if (pendingId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedAttachmentId(pendingId);
        pendingId = null;
        return;
      }
      if (event.defaultPrevented) return;

      // Not an attachment link - see if the click landed on one of the
      // page's images, so it can open the zoom viewer instead of doing
      // nothing (view mode never makes the image itself interactive).
      const target = event.target;
      if (!(target instanceof Element)) return;
      const image = target.closest("img");
      if (image instanceof HTMLImageElement && image.src) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setZoomImage({ src: image.src, alt: image.alt || "" });
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const image = target.closest("img");
      if (image instanceof HTMLImageElement && image.src) {
        event.preventDefault();
        event.stopPropagation();
        setImageContextMenu({
          x: event.clientX,
          y: event.clientY,
          src: image.src,
          alt: image.alt || "",
        });
      }
    };

    const onOpenAttachmentModal = (event: Event) => {
      const customEvt = event as CustomEvent<{ attachmentId?: string }>;
      if (customEvt.detail?.attachmentId) {
        setSelectedAttachmentId(customEvt.detail.attachmentId);
      }
    };
    window.addEventListener(
      "wikihub:open-attachment-modal",
      onOpenAttachmentModal,
    );

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    container.addEventListener("contextmenu", handleContextMenu, true);
    return () => {
      window.removeEventListener(
        "wikihub:open-attachment-modal",
        onOpenAttachmentModal,
      );
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("click", handleClick, true);
      container.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, [exportMode]);

  return (
    <div
      ref={editorContainerRef}
      className={cn(
        "wikihub-reader wikihub-page-content relative",
        exportMode && "wikihub-export",
      )}
    >
      <EditorContent editor={editor} />
      {exportMode ? null : (
        <>
          <AttachmentDetailsModal
            // Keying on the attachment makes each one a fresh mount, so the modal
            // never has to reset its own state on the way out.
            key={selectedAttachmentId ?? "none"}
            attachmentId={selectedAttachmentId}
            canEditOffice={canEditAttachments}
            onClose={() => setSelectedAttachmentId(null)}
          />
          <ImageContextMenu
            menu={imageContextMenu}
            onClose={() => setImageContextMenu(null)}
            onZoom={(image) => setZoomImage(image)}
          />
          <ImageLightbox
            // Keying on the src makes each image (and the closed state) a
            // fresh mount, so zoom/pan never has to reset itself on switch.
            key={zoomImage?.src ?? "none"}
            image={zoomImage}
            onClose={() => setZoomImage(null)}
          />
        </>
      )}
    </div>
  );
}

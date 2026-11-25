"use client";

import { type Node as PMNode } from "@tiptap/pm/model";
import { type Editor } from "@tiptap/react";
import {
  Bold,
  ChevronRight,
  Code2,
  FilePlus2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListTree,
  ListOrdered,
  ListTodo,
  Minus,
  Network,
  Paperclip,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  UnfoldHorizontal,
  Underline,
  Undo2,
  WrapText,
  FileText,
  Loader2,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { toggleListBlock, toggleToggleBlock } from "@/components/pages/slash-command";
import type { WikiPage } from "@/types/api";

import {
  AlignmentMenu,
  ColorMenu,
  HeadingMenu,
  MoreFormattingMenu,
  OverflowToolbarButton,
  TablePicker,
  ToolbarButton,
} from "./toolbar-controls";

export function RichTextToolbar({
  editor,
  wrapText,
  onToggleWrap,
  onUploadFile,
  pageLinkContext,
  onSubpageCreated,
}: {
  editor: Editor | null;
  wrapText: boolean;
  onToggleWrap: () => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
  // Threaded down from RichTextEditor's own optional prop of the same name -
  // undefined wherever there's no real page to search/parent to (the space
  // overview editor), in which case "Link to page"/"Create sub-page" in the
  // slash menu still dispatch their events but nothing here answers them.
  pageLinkContext?: { spaceKey: string; currentPageId: string | null };
  onSubpageCreated?: (page: WikiPage) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkTarget, setLinkTarget] = useState("_blank");
  const linkSelection = useRef<{ from: number; to: number } | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const { t } = useTranslation();
  const [pagePickerSearch, setPagePickerSearch] = useState("");
  const [pagePickerPages, setPagePickerPages] = useState<WikiPage[]>([]);
  const [pagePickerLoading, setPagePickerLoading] = useState(false);
  const [subpageOpen, setSubpageOpen] = useState(false);
  const [subpageTitle, setSubpageTitle] = useState("");
  const [subpagePending, setSubpagePending] = useState(false);
  const toolbarActionsRef = useRef<HTMLDivElement>(null);
  const [visibleOverflowActionCount, setVisibleOverflowActionCount] =
    useState(11);
  const [toolbarMeasureVersion, setToolbarMeasureVersion] = useState(0);

  useLayoutEffect(() => {
    const toolbar = toolbarActionsRef.current;
    if (!toolbar) return;
    if (
      toolbar.scrollWidth > toolbar.clientWidth + 1 &&
      visibleOverflowActionCount > 0
    ) {
      setVisibleOverflowActionCount((count) => count - 1);
    }
  }, [toolbarMeasureVersion, visibleOverflowActionCount]);

  useLayoutEffect(() => {
    const toolbar = toolbarActionsRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      // Recalculate from the full action set. Layout effects run before paint,
      // so this doesn't make the editor toolbar jump while its container grows.
      setVisibleOverflowActionCount(11);
      setToolbarMeasureVersion((version) => version + 1);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const openLinkDialog = useCallback(
    (customData?: {
      href?: string;
      text?: string;
      title?: string;
      target?: string;
    }) => {
      if (!editor) return;
      if (editor.isActive("link")) {
        editor.commands.extendMarkRange("link");
      }
      const { from, to } = editor.state.selection;
      const attributes = editor.getAttributes("link");
      linkSelection.current = { from, to };
      const currentSelectedText =
        from !== to ? editor.state.doc.textBetween(from, to, " ") : "";

      const href =
        customData?.href ?? (attributes.href as string | undefined) ?? "";
      const title =
        customData?.title ?? (attributes.title as string | undefined) ?? "";
      const target =
        customData?.target ??
        (attributes.target as string | undefined) ??
        "_blank";
      const text =
        customData?.text ||
        currentSelectedText ||
        (attributes.href as string | undefined) ||
        "";

      setLinkUrl(href);
      setLinkTitle(title);
      setLinkTarget(target === "_self" ? "_self" : "_blank");
      setLinkText(text);
      setLinkOpen(true);
    },
    [editor],
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const customEvt = event as CustomEvent<{
        href?: string;
        text?: string;
        title?: string;
        target?: string;
      }>;
      openLinkDialog(customEvt.detail);
    };
    window.addEventListener("wikihub:open-link-dialog", handleOpen);
    return () => {
      window.removeEventListener("wikihub:open-link-dialog", handleOpen);
    };
  }, [openLinkDialog]);

  function saveLink(
    event?: React.FormEvent<HTMLFormElement> | React.MouseEvent,
  ) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!editor) return;

    let href = linkUrl.trim();
    const selection = linkSelection.current;
    if (selection) {
      editor.commands.setTextSelection(selection);
    }
    if (editor.isActive("link")) {
      editor.commands.extendMarkRange("link");
    }

    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }

    if (
      !href.startsWith("http://") &&
      !href.startsWith("https://") &&
      !href.startsWith("/") &&
      !href.startsWith("#") &&
      !href.startsWith("mailto:") &&
      !href.startsWith("tel:")
    ) {
      href = `https://${href}`;
    }

    const attrs = {
      href,
      title: linkTitle.trim() || null,
      target: linkTarget === "_self" ? "_self" : "_blank",
    };
    const displayText = linkText.trim() || href;
    const chain = editor.chain().focus();
    const curSelection = editor.state.selection;
    if (curSelection.from !== curSelection.to) {
      const selectedText = editor.state.doc.textBetween(
        curSelection.from,
        curSelection.to,
        " ",
      );
      if (displayText !== selectedText) {
        chain
          .deleteSelection()
          .insertContent({
            type: "text",
            text: displayText,
            marks: [{ type: "link", attrs }],
          })
          .run();
      } else {
        chain.extendMarkRange("link").setLink(attrs).run();
      }
    } else {
      chain
        .insertContent({
          type: "text",
          text: displayText,
          marks: [{ type: "link", attrs }],
        })
        .run();
    }
    setLinkOpen(false);
  }

  const insertAttachment = useCallback(() => {
    if (!editor) return;
    attachmentInput.current?.click();
  }, [editor]);

  const insertImage = useCallback(() => {
    if (!editor) return;
    imageInput.current?.click();
  }, [editor]);

  const openPagePicker = useCallback(() => {
    if (!editor || !pageLinkContext) return;
    setPagePickerSearch("");
    setPagePickerOpen(true);
    setPagePickerLoading(true);
    void api
      .get<WikiPage[]>(
        `/api/v1/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages`,
      )
      .then(setPagePickerPages)
      .catch(() => {
        toast.error(t("editor.loadPagesError"));
        setPagePickerPages([]);
      })
      .finally(() => setPagePickerLoading(false));
  }, [editor, pageLinkContext, t]);

  function insertPageLink(page: WikiPage) {
    if (!editor || !pageLinkContext) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: page.title,
        marks: [
          {
            type: "link",
            attrs: {
              href: `/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
            },
          },
        ],
      })
      .run();
    setPagePickerOpen(false);
  }

  const openSubpageDialog = useCallback(() => {
    if (!editor || !pageLinkContext) return;
    setSubpageTitle("");
    setSubpageOpen(true);
  }, [editor, pageLinkContext]);

  async function submitSubpage(
    event?: React.FormEvent<HTMLFormElement> | React.MouseEvent,
  ) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!editor || !pageLinkContext) return;
    const trimmedTitle = subpageTitle.trim();
    if (!trimmedTitle) return;

    setSubpagePending(true);
    try {
      const page = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages`,
        {
          title: trimmedTitle,
          content: "",
          parent_id: pageLinkContext.currentPageId,
        },
      );
      // Insert the link into THIS document before handing off to
      // onSubpageCreated, which typically saves this document and then
      // navigates away - the editor instance (and this component) is gone
      // once that happens, so the link has to land first.
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: page.title,
          marks: [
            {
              type: "link",
              attrs: {
                href: `/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
              },
            },
          ],
        })
        .run();
      setSubpageOpen(false);
      onSubpageCreated?.(page);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("editor.createPageError"),
      );
    } finally {
      setSubpagePending(false);
    }
  }

  // The slash-command menu (slash-command.tsx) can't reach these directly -
  // it's an editor-instance-agnostic extension, while the hidden file inputs
  // and upload state live here. It dispatches the same kind of CustomEvent
  // this file already uses for "a node view needs a toolbar-owned action"
  // (see the image node view's "wikihub:view-file-details").
  useEffect(() => {
    const onSlashInsertImage = () => insertImage();
    const onSlashInsertAttachment = () => insertAttachment();
    const onSlashLinkToPage = () => openPagePicker();
    const onSlashCreateSubpage = () => openSubpageDialog();
    document.addEventListener("wikihub:slash-insert-image", onSlashInsertImage);
    document.addEventListener(
      "wikihub:slash-insert-attachment",
      onSlashInsertAttachment,
    );
    document.addEventListener("wikihub:slash-link-to-page", onSlashLinkToPage);
    document.addEventListener(
      "wikihub:slash-create-subpage",
      onSlashCreateSubpage,
    );
    return () => {
      document.removeEventListener(
        "wikihub:slash-insert-image",
        onSlashInsertImage,
      );
      document.removeEventListener(
        "wikihub:slash-insert-attachment",
        onSlashInsertAttachment,
      );
      document.removeEventListener(
        "wikihub:slash-link-to-page",
        onSlashLinkToPage,
      );
      document.removeEventListener(
        "wikihub:slash-create-subpage",
        onSlashCreateSubpage,
      );
    };
  }, [insertImage, insertAttachment, openPagePicker, openSubpageDialog]);

  async function insertFiles(files: File[]) {
    if (!editor || files.length === 0) return;
    setUploadError(null);
    if (!onUploadFile) {
      const image = files.find((file) => file.type.startsWith("image/"));
      if (!image) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") {
          editor.chain().focus().setImage({ src: reader.result }).run();
        }
      });
      reader.readAsDataURL(image);
      return;
    }

    setUploading(true);
    const items = files.map((file, idx) => ({
      file,
      uploadId: `up-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
    }));

    const placeholders = items.map((item) => ({
      type: "attachment",
      attrs: {
        filename: item.file.name,
        displayMode: "card",
        uploading: true,
        uploadId: item.uploadId,
      },
    }));

    editor.chain().focus().insertContent(placeholders).run();

    try {
      for (const item of items) {
        try {
          const uploaded = await onUploadFile(item.file);
          let targetPos: number | null = null;
          let targetNode: PMNode | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (
              node.type.name === "attachment" &&
              node.attrs.uploadId === item.uploadId
            ) {
              targetPos = pos;
              targetNode = node;
              return false;
            }
          });

          if (targetPos !== null && targetNode) {
            if (uploaded.content_type.startsWith("image/")) {
              const imageType = editor.schema.nodes.image;
              if (imageType) {
                const imageNode = imageType.create({
                  src: uploaded.content_url,
                  alt: uploaded.filename,
                });
                const tr = editor.state.tr.replaceWith(
                  targetPos,
                  targetPos + (targetNode as PMNode).nodeSize,
                  imageNode,
                );
                editor.view.dispatch(tr);
              }
            } else {
              const tr = editor.state.tr.setNodeMarkup(targetPos, undefined, {
                ...(targetNode as PMNode).attrs,
                href: uploaded.content_url,
                filename: uploaded.filename,
                uploading: false,
                uploadId: null,
              });
              editor.view.dispatch(tr);
            }
          }
        } catch (itemErr) {
          let targetPos: number | null = null;
          let targetNode: PMNode | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (
              node.type.name === "attachment" &&
              node.attrs.uploadId === item.uploadId
            ) {
              targetPos = pos;
              targetNode = node;
              return false;
            }
          });
          if (targetPos !== null && targetNode) {
            const tr = editor.state.tr.delete(
              targetPos,
              targetPos + (targetNode as PMNode).nodeSize,
            );
            editor.view.dispatch(tr);
          }
          throw itemErr;
        }
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : t("editor.uploadError"),
      );
    } finally {
      setUploading(false);
    }
  }

  function handleAttachmentSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void insertFiles(files);
  }

  useEffect(() => {
    if (!editor) return;
    const handleDroppedFiles = (event: Event) => {
      void insertFiles((event as CustomEvent<File[]>).detail);
    };
    editor.view.dom.addEventListener(
      "wikihub:editor-files",
      handleDroppedFiles,
    );
    return () =>
      editor.view.dom.removeEventListener(
        "wikihub:editor-files",
        handleDroppedFiles,
      );
  });

  return (
    <div
      className="border-border bg-surface-sunken top-topbar sticky z-20 flex flex-nowrap items-center gap-1 overflow-hidden rounded-t-md border px-1 py-1 shadow-xs md:top-0 [&>button]:shrink-0"
      role="toolbar"
      aria-label={t("editor.pageFormattingAria")}
    >
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleAttachmentSelected}
      />
      <input
        ref={attachmentInput}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleAttachmentSelected}
      />
      <div
        ref={toolbarActionsRef}
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden [&>button]:shrink-0"
      >
        <ToolbarButton
          editor={editor}
          label={t("editor.bold")}
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.italic")}
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.underline")}
          active={editor?.isActive("underline")}
          onClick={() => editor?.chain().focus().toggleMark("underline").run()}
        >
          <Underline />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.strikethrough")}
          active={editor?.isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.inlineCode")}
          active={editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code2 />
        </ToolbarButton>
        <ColorMenu editor={editor} kind="text" />
        <ColorMenu editor={editor} kind="highlight" />
        <ToolbarButton
          editor={editor}
          label={t("editor.clearTextColourHighlight")}
          onClick={() => {
            if (!editor) return;
            const markType = editor.schema.marks.textStyle;
            if (!markType) return;

            const { from, to } = editor.state.selection;
            if (from === to) {
              editor.commands.unsetMark("textStyle", {
                extendEmptyMarkRange: true,
              });
            } else {
              editor.view.dispatch(
                editor.state.tr.removeMark(from, to, markType),
              );
              editor.view.focus();
            }
          }}
        >
          <RemoveFormatting />
        </ToolbarButton>
        <span aria-hidden className="bg-border mx-1 h-5 w-px" />
        <HeadingMenu editor={editor} />
        <AlignmentMenu editor={editor} />
        {visibleOverflowActionCount > 0 ? (
          <ToolbarButton
            editor={editor}
            label={wrapText ? "Unwrap text" : "Wrap text"}
            active={wrapText}
            onClick={onToggleWrap}
          >
            {wrapText ? <UnfoldHorizontal /> : <WrapText />}
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 1 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.bulletedList")}
            active={editor?.isActive("bulletList")}
            onClick={() =>
              editor && toggleListBlock(editor, "toggleBulletList")
            }
          >
            <List />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 2 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.numberedList")}
            active={editor?.isActive("orderedList")}
            onClick={() =>
              editor && toggleListBlock(editor, "toggleOrderedList")
            }
          >
            <ListOrdered />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 3 ? (
          <ToolbarButton
            editor={editor}
            label="To-do list"
            active={editor?.isActive("taskList")}
            onClick={() => editor && toggleListBlock(editor, "toggleTaskList")}
          >
            <ListTodo />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 4 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.toggleList")}
            active={editor?.isActive("toggle")}
            onClick={() => editor && toggleToggleBlock(editor)}
          >
            <ChevronRight />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 5 ? (
          <ToolbarButton
            editor={editor}
            label="Quote"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 6 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.codeBlock")}
            active={editor?.isActive("codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="fill-current" />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 7 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.insertDivider")}
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 8 ? (
          <ToolbarButton
            editor={editor}
            label={t("editor.addLink")}
            onClick={openLinkDialog}
          >
            <Link2 />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 9 ? (
          <ToolbarButton
            editor={editor}
            label={
              uploading ? t("editor.uploadingImage") : t("editor.insertImage")
            }
            disabled={uploading}
            onClick={insertImage}
          >
            {uploading ? (
              <ImagePlus className="animate-pulse" />
            ) : (
              <ImagePlus />
            )}
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 10 ? (
          <ToolbarButton
            editor={editor}
            label={
              uploading ? t("editor.uploadingFile") : t("editor.uploadFile")
            }
            disabled={uploading}
            onClick={insertAttachment}
          >
            {uploading ? (
              <Paperclip className="animate-pulse" />
            ) : (
              <Paperclip />
            )}
          </ToolbarButton>
        ) : null}
        <TablePicker editor={editor} />
        <ToolbarButton
          editor={editor}
          label={t("editor.insertToc")}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertContent({ type: "tableOfContents" })
              .run()
          }
        >
          <ListTree />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.insertDiagram")}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "diagram",
                attrs: {
                  code: "",
                  look: "classic",
                },
              })
              .run()
          }
        >
          <Network />
        </ToolbarButton>
      </div>
      <div className="border-border ml-auto flex shrink-0 items-center gap-1 border-l pl-1">
        <ToolbarButton
          editor={editor}
          label={t("editor.undo")}
          disabled={!editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("editor.redo")}
          disabled={!editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </ToolbarButton>
        {visibleOverflowActionCount < 11 ? (
          <MoreFormattingMenu>
            {visibleOverflowActionCount < 1 ? (
              <OverflowToolbarButton
                label={
                  wrapText
                    ? t("sourceEditor.unwrapText")
                    : t("sourceEditor.wrapText")
                }
                active={wrapText}
                onClick={onToggleWrap}
              >
                {wrapText ? <UnfoldHorizontal /> : <WrapText />}
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 2 ? (
              <OverflowToolbarButton
                label={t("editor.bulletedList")}
                active={editor?.isActive("bulletList")}
                onClick={() =>
                  editor && toggleListBlock(editor, "toggleBulletList")
                }
              >
                <List />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 3 ? (
              <OverflowToolbarButton
                label={t("editor.numberedList")}
                active={editor?.isActive("orderedList")}
                onClick={() =>
                  editor && toggleListBlock(editor, "toggleOrderedList")
                }
              >
                <ListOrdered />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 4 ? (
              <OverflowToolbarButton
                label={t("slash.todoListLabel")}
                active={editor?.isActive("taskList")}
                onClick={() =>
                  editor && toggleListBlock(editor, "toggleTaskList")
                }
              >
                <ListTodo />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 5 ? (
              <OverflowToolbarButton
                label={t("editor.toggleList")}
                active={editor?.isActive("toggle")}
                onClick={() => editor && toggleToggleBlock(editor)}
              >
                <ChevronRight />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 6 ? (
              <OverflowToolbarButton
                label={t("editor.quote")}
                active={editor?.isActive("blockquote")}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <Quote />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 7 ? (
              <OverflowToolbarButton
                label={t("editor.codeBlock")}
                active={editor?.isActive("codeBlock")}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              >
                <Code2 className="fill-current" />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 8 ? (
              <OverflowToolbarButton
                label={t("editor.insertDivider")}
                onClick={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              >
                <Minus />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 9 ? (
              <OverflowToolbarButton
                label={t("editor.addLink")}
                onClick={openLinkDialog}
              >
                <Link2 />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 10 ? (
              <OverflowToolbarButton
                label={
                  uploading
                    ? t("editor.uploadingImage")
                    : t("editor.insertImage")
                }
                disabled={uploading}
                onClick={insertImage}
              >
                {uploading ? (
                  <ImagePlus className="animate-pulse" />
                ) : (
                  <ImagePlus />
                )}
              </OverflowToolbarButton>
            ) : null}
            <OverflowToolbarButton
              label={
                uploading ? t("editor.uploadingFile") : t("editor.uploadFile")
              }
              disabled={uploading}
              onClick={insertAttachment}
            >
              {uploading ? (
                <Paperclip className="animate-pulse" />
              ) : (
                <Paperclip />
              )}
            </OverflowToolbarButton>
          </MoreFormattingMenu>
        ) : null}
      </div>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          title={linkUrl ? t("editor.editLink") : t("editor.insertLink")}
          className="max-w-xl"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              saveLink(e);
            }}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <label htmlFor="link-url" className="text-sm font-medium">
                {t("editor.urlLabel")}
              </label>
              <Input
                id="link-url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://example.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-text" className="text-sm font-medium">
                {t("editor.linkLabel")}
              </label>
              <Input
                id="link-text"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder={t("editor.linkTextPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-title" className="text-sm font-medium">
                {t("editor.title")}
              </label>
              <Input
                id="link-title"
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder={t("editor.optional")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-target" className="text-sm font-medium">
                {t("editor.openLinkIn")}
              </label>
              <Select value={linkTarget} onValueChange={setLinkTarget}>
                <SelectTrigger
                  id="link-target"
                  aria-label={t("editor.openLinkIn")}
                >
                  <SelectValue>
                    {linkTarget === "_blank"
                      ? t("editor.targetBlank")
                      : t("editor.targetSelf")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_self">
                    {t("editor.targetSelf")}
                  </SelectItem>
                  <SelectItem value="_blank">
                    {t("editor.targetBlank")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLinkOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                onClick={(e) => e.stopPropagation()}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={pagePickerOpen} onOpenChange={setPagePickerOpen}>
        <DialogContent title={t("slash.linkLabel")} className="max-w-md">
          <div className="space-y-3">
            <div className="relative">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2"
              />
              <input
                type="search"
                role="combobox"
                aria-expanded
                aria-controls="slash-page-picker-options"
                aria-label={t("editor.searchPagesAria")}
                autoFocus
                value={pagePickerSearch}
                onChange={(event) => setPagePickerSearch(event.target.value)}
                placeholder="Search pages..."
                className={cn(inputClassName, "pl-9")}
              />
            </div>
            <div
              id="slash-page-picker-options"
              role="listbox"
              aria-label={t("editor.pagesAria")}
              className="border-border max-h-64 overflow-y-auto rounded-md border p-1"
            >
              {pagePickerLoading ? (
                <p className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
                  <Loader2 className="size-4 animate-spin" />{" "}
                  {t("editor.loadingPages")}
                </p>
              ) : (
                (() => {
                  const results = pagePickerPages.filter(
                    (page) =>
                      page.id !== pageLinkContext?.currentPageId &&
                      page.title
                        .toLowerCase()
                        .includes(pagePickerSearch.trim().toLowerCase()),
                  );
                  if (results.length === 0) {
                    return (
                      <p className="text-muted-foreground px-2 py-1.5 text-sm">
                        {t("movePage.noMatchingPages")}
                      </p>
                    );
                  }
                  return results.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => insertPageLink(page)}
                      className="text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <FileText
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{page.title}</span>
                    </button>
                  ));
                })()
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={subpageOpen} onOpenChange={setSubpageOpen}>
        <DialogContent
          title={t("slash.createSubpageLabel")}
          description={t("editor.subpageDescription")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitSubpage(e);
            }}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="slash-subpage-title">{t("editor.title")}</Label>
              <Input
                id="slash-subpage-title"
                value={subpageTitle}
                onChange={(event) => setSubpageTitle(event.target.value)}
                placeholder={t("editor.newSubpagePlaceholder")}
                autoFocus
                required
                maxLength={255}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSubpageOpen(false)}
                disabled={subpagePending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                onClick={(e) => e.stopPropagation()}
                disabled={subpagePending || !subpageTitle.trim()}
              >
                {subpagePending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FilePlus2 />
                )}
                {subpagePending
                  ? t("pageCreate.creating")
                  : t("pageCreate.createTitle")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {uploadError ? (
        <p className="text-danger basis-full px-2 py-1 text-xs" role="alert">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

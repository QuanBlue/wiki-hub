"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Mark, mergeAttributes } from "@tiptap/core";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Columns3,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  SquareSplitHorizontal,
  Table2,
  TableCellsMerge,
  Type,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
});

const TextStyleMark = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.color || null,
        renderHTML: (attributes) =>
          attributes.color ? { style: `color: ${attributes.color}` } : {},
      },
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-wikihub-text-style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-wikihub-text-style": "" }),
      0,
    ];
  },
});

const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
});

const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    defaultProtocol: "https",
  }),
  Image.configure({
    allowBase64: false,
  }),
  TextStyleMark,
  Table.configure({
    resizable: true,
    cellMinWidth: 96,
  }),
  TableRow,
  TableHeaderWithBackground,
  TableCellWithBackground,
  Placeholder.configure({
    placeholder: "Write your documentation here...",
  }),
];

const headingLevels = [1, 2, 3] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert Confluence's XML-style code macro into semantic HTML for Tiptap. */
function normalizeConfluenceCodeMacros(content: string): string {
  return content.replace(
    /<ac:structured-macro\b[^>]*\bac:name=(?:"code"|'code')[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (macro, inner: string) => {
      const code = inner.match(
        /<ac:plain-text-body\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/i,
      )?.[1];
      if (code === undefined) return macro;
      const langMatch = inner.match(
        /<ac:parameter\b[^>]*\bac:name=(?:"language"|'language')[^>]*>([\s\S]*?)<\/ac:parameter>/i,
      );
      const language =
        langMatch?.[1]?.trim()?.replace(/[^a-z0-9_-]/gi, "") || "";
      return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code)}</code></pre>`;
    },
  );
}

const editorClassName =
  "min-h-[calc(100vh-19rem)] px-5 py-4 text-sm leading-7 outline-none " +
  "[&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] " +
  "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold " +
  "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold " +
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 " +
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border " +
  "[&_.tableWrapper]:my-4 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:min-w-24 [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:min-w-24 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_.selectedCell]:bg-primary-subtle";

function ToolbarButton({
  editor,
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  editor: Editor | null;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={!editor || disabled}
      onClick={onClick}
      className={cn(active && "bg-surface-selected text-primary")}
    >
      {children}
    </Button>
  );
}

function HeadingMenu({ editor }: { editor: Editor | null }) {
  const currentLevel =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        headingLevels.find((level) =>
          currentEditor?.isActive("heading", { level }),
        ),
    }) ?? undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Text style"
          title="Text style"
          disabled={!editor}
          className={cn(
            "h-8 min-w-14 px-2",
            currentLevel && "bg-surface-selected text-primary",
          )}
        >
          {currentLevel ? `H${currentLevel}` : "Text"}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setParagraph().run()}
        >
          <Pilcrow />
          Paragraph
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 1 }).run()
          }
        >
          <Heading1 />
          Heading 1
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
          Heading 2
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 3 }).run()
          }
        >
          <Heading3 />
          Heading 3
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type TableMenuPosition = { left: number; top: number };

/**
 * Table actions live in a viewport-positioned surface instead of the main
 * toolbar. Keeping it out of document flow means entering a table never makes
 * the formatting bar wrap or shifts the editor content below it.
 */
function TableActionsMenu({ editor }: { editor: Editor | null }) {
  const [position, setPosition] = useState<TableMenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!editor?.isActive("table")) {
      setPosition(null);
      return;
    }

    const { node } = editor.view.domAtPos(editor.state.selection.$from.pos);
    const table =
      (node instanceof Element ? node : node.parentElement)?.closest("table") ??
      null;

    if (!table) {
      setPosition(null);
      return;
    }

    const rect = table.getBoundingClientRect();
    setPosition({
      // Leave enough room for the compact menu while keeping it on-screen.
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 400)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 48),
    });
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor) return;

    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    updatePosition();

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [editor, updatePosition]);

  if (!position) return null;

  return (
    <div
      className="border-border bg-surface-raised fixed z-50 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-md border p-1 shadow-lg"
      style={position}
      role="toolbar"
      aria-label="Table actions"
      onMouseDown={(event) => {
        // Keep the ProseMirror selection for button actions, but let the native
        // colour picker receive its normal pointer interaction.
        if ((event.target as HTMLElement).closest("button")) {
          event.preventDefault();
        }
      }}
    >
      <ToolbarButton
        editor={editor}
        label="Add row"
        onClick={() => editor?.chain().focus().addRowAfter().run()}
      >
        <Rows3 />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Add column"
        onClick={() => editor?.chain().focus().addColumnAfter().run()}
      >
        <Columns3 />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Merge selected cells"
        onClick={() => editor?.chain().focus().mergeCells().run()}
      >
        <TableCellsMerge />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Split cell"
        onClick={() => editor?.chain().focus().splitCell().run()}
      >
        <SquareSplitHorizontal />
      </ToolbarButton>
      <div className="relative">
        <Palette
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        />
        <select
          aria-label="Cell background colour"
          title="Cell background colour"
          defaultValue=""
          onChange={(event) => {
            editor
              ?.chain()
              .focus()
              .setCellAttribute("backgroundColor", event.target.value || null)
              .run();
            event.currentTarget.value = "";
          }}
          className="border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring h-8 cursor-pointer rounded-md border py-1 pr-2 pl-7 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <option value="">Cell colour</option>
          <option value="var(--primary-subtle)">Blue</option>
          <option value="var(--surface-sunken)">Neutral</option>
          <option value="var(--wh-success-bg)">Green</option>
          <option value="var(--wh-warning-bg)">Amber</option>
          <option value="var(--wh-danger-bg)">Red</option>
        </select>
      </div>
      <ToolbarButton
        editor={editor}
        label="Delete table"
        onClick={() => editor?.chain().focus().deleteTable().run()}
      >
        <Trash2 />
      </ToolbarButton>
    </div>
  );
}

function RichTextToolbar({ editor }: { editor: Editor | null }) {
  function insertLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Paste a link URL", previous ?? "");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function insertImage() {
    if (!editor) return;
    const src = window.prompt("Paste an image URL");
    if (!src?.trim()) return;
    try {
      const url = new URL(src);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
      editor.chain().focus().setImage({ src: url.href }).run();
    } catch {
      window.alert("Use a valid http or https image URL.");
    }
  }

  return (
    <div
      className="border-border bg-surface-sunken flex flex-wrap items-center gap-0.5 rounded-t-md border px-1 py-1"
      role="toolbar"
      aria-label="Page formatting"
    >
      <ToolbarButton
        editor={editor}
        label="Bold"
        active={editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Italic"
        active={editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Inline code"
        active={editor?.isActive("code")}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code2 />
      </ToolbarButton>
      <div className="relative">
        <Type
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        />
        <select
          aria-label="Text colour"
          title="Text colour"
          defaultValue=""
          disabled={!editor}
          onChange={(event) => {
            if (!event.target.value) return;
            const attributes = editor?.getAttributes("textStyle") ?? {};
            editor
              ?.chain()
              .focus()
              .setMark("textStyle", {
                ...attributes,
                color: event.target.value,
              })
              .run();
            event.currentTarget.value = "";
          }}
          className="border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring h-8 cursor-pointer rounded-md border py-1 pr-2 pl-7 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          <option value="">Text colour</option>
          <option value="var(--primary)">Blue</option>
          <option value="var(--wh-success)">Green</option>
          <option value="var(--wh-warning)">Amber</option>
          <option value="var(--danger)">Red</option>
          <option value="var(--muted-foreground)">Muted</option>
        </select>
      </div>
      <div className="relative">
        <Palette
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        />
        <select
          aria-label="Text background colour"
          title="Text background colour"
          defaultValue=""
          disabled={!editor}
          onChange={(event) => {
            if (!event.target.value) return;
            const attributes = editor?.getAttributes("textStyle") ?? {};
            editor
              ?.chain()
              .focus()
              .setMark("textStyle", {
                ...attributes,
                backgroundColor: event.target.value,
              })
              .run();
            event.currentTarget.value = "";
          }}
          className="border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring h-8 cursor-pointer rounded-md border py-1 pr-2 pl-7 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          <option value="">Text highlight</option>
          <option value="var(--primary-subtle)">Blue</option>
          <option value="var(--surface-sunken)">Neutral</option>
          <option value="var(--wh-success-bg)">Green</option>
          <option value="var(--wh-warning-bg)">Amber</option>
          <option value="var(--wh-danger-bg)">Red</option>
        </select>
      </div>
      <ToolbarButton
        editor={editor}
        label="Clear text colour and highlight"
        disabled={!editor?.isActive("textStyle")}
        onClick={() => editor?.chain().focus().unsetMark("textStyle").run()}
      >
        <RemoveFormatting />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <HeadingMenu editor={editor} />
      <ToolbarButton
        editor={editor}
        label="Bulleted list"
        active={editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Numbered list"
        active={editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Quote"
        active={editor?.isActive("blockquote")}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Code block"
        active={editor?.isActive("codeBlock")}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="fill-current" />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <ToolbarButton editor={editor} label="Add link" onClick={insertLink}>
        <Link2 />
      </ToolbarButton>
      <ToolbarButton editor={editor} label="Insert image" onClick={insertImage}>
        <ImagePlus />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <ToolbarButton
        editor={editor}
        label="Insert table"
        onClick={() =>
          editor
            ?.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Table2 />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <ToolbarButton
        editor={editor}
        label="Undo"
        disabled={!editor?.can().undo()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Redo"
        disabled={!editor?.can().redo()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (html: string) => void;
}) {
  const normalizedContent = useMemo(
    () => normalizeConfluenceCodeMacros(content),
    [content],
  );
  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content: normalizedContent,
    editorProps: { attributes: { class: editorClassName } },
    onUpdate: ({ editor: updatedEditor }) => onChange(updatedEditor.getHTML()),
  });

  return (
    <div>
      <RichTextToolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="border-border bg-surface focus-within:ring-ring focus-within:ring-offset-background rounded-b-md border border-t-0 focus-within:ring-2 focus-within:ring-offset-2"
      />
      <TableActionsMenu editor={editor} />
    </div>
  );
}

export function RichTextContent({ content }: { content: string }) {
  const normalizedContent = useMemo(
    () => normalizeConfluenceCodeMacros(content),
    [content],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: editorExtensions,
    content: normalizedContent,
    editorProps: {
      attributes: {
        class: cn(editorClassName, "min-h-0 px-0 py-0"),
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(normalizedContent, { emitUpdate: false });
    }
  }, [editor, normalizedContent]);

  return <EditorContent editor={editor} />;
}

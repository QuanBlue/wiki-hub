"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
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
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
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
  Minus,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  SquareSplitHorizontal,
  Strikethrough,
  Table2,
  TableCellsMerge,
  Type,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
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
  UnderlineMark,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
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

function linkifyPlainTextUrls(content: string): string {
  if (typeof document === "undefined" || !content) return content;
  const parsed = document.implementation.createHTMLDocument("");
  parsed.body.innerHTML = content;
  const urlPattern = /\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)]/g;
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement?.tagName;
    if (parent !== "A" && parent !== "CODE" && parent !== "PRE") {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    if (!urlPattern.test(textNode.data)) {
      urlPattern.lastIndex = 0;
      continue;
    }
    urlPattern.lastIndex = 0;
    const fragment = parsed.createDocumentFragment();
    let lastIndex = 0;
    textNode.data.replace(urlPattern, (url: string, offset: number) => {
      fragment.append(textNode.data.slice(lastIndex, offset));
      const anchor = parsed.createElement("a");
      anchor.href = url;
      anchor.textContent = url;
      fragment.append(anchor);
      lastIndex = offset + url.length;
      return url;
    });
    fragment.append(textNode.data.slice(lastIndex));
    textNode.replaceWith(fragment);
  }
  return parsed.body.innerHTML;
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

// Imported pages are read like documentation, not like an editor canvas.
// Keep this separate from editorClassName so editing remains comfortable while
// imported Confluence pages retain their compact, scan-friendly rhythm.
const readerClassName =
  "text-sm leading-[1.45] " +
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight " +
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/50 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:text-primary-hover [&_a:hover]:decoration-primary " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-w-[42rem] [&_img]:rounded-md [&_img]:border [&_img]:border-border " +
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5";

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

function AlignmentMenu({ editor }: { editor: Editor | null }) {
  const alignment =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor?.getAttributes("paragraph").textAlign ?? "left",
    }) ?? "left";
  const Icon =
    alignment === "center"
      ? AlignCenter
      : alignment === "right"
        ? AlignRight
        : AlignLeft;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Text alignment"
          title="Text alignment"
          disabled={!editor}
          className={cn(alignment !== "left" && "bg-surface-selected text-primary")}
        >
          <Icon />
          <ChevronDown className="sr-only" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuItem onSelect={() => editor?.chain().focus().setTextAlign("left").run()}>
          <AlignLeft />
          Align left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor?.chain().focus().setTextAlign("center").run()}>
          <AlignCenter />
          Align center
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor?.chain().focus().setTextAlign("right").run()}>
          <AlignRight />
          Align right
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const textColorOptions = [
  { label: "Blue", value: "var(--primary)" },
  { label: "Green", value: "var(--wh-success)" },
  { label: "Amber", value: "var(--wh-warning)" },
  { label: "Red", value: "var(--danger)" },
  { label: "Muted", value: "var(--muted-foreground)" },
];

const highlightOptions = [
  { label: "Blue", value: "var(--primary-subtle)" },
  { label: "Neutral", value: "var(--surface-sunken)" },
  { label: "Green", value: "var(--wh-success-bg)" },
  { label: "Amber", value: "var(--wh-warning-bg)" },
  { label: "Red", value: "var(--wh-danger-bg)" },
];

const cellColorOptions = [
  "var(--primary-subtle)",
  "var(--wh-info-bg)",
  "var(--wh-warning-bg)",
  "var(--wh-danger-bg)",
  "var(--surface-selected)",
  "var(--wh-success-bg)",
  "var(--wh-warning)",
  "var(--danger)",
  "var(--primary)",
  "var(--wh-info)",
  "var(--surface-hover)",
  "var(--border-strong)",
  "var(--muted-foreground)",
  "var(--foreground)",
  "var(--primary-hover)",
  "var(--surface-sunken)",
  "var(--surface)",
  "var(--surface-raised)",
  "var(--border)",
  "var(--background)",
];

function ColorMenu({
  editor,
  kind,
}: {
  editor: Editor | null;
  kind: "text" | "highlight";
}) {
  const isText = kind === "text";
  const options = isText ? textColorOptions : highlightOptions;
  const currentValue = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor?.getAttributes("textStyle")[
        isText ? "color" : "backgroundColor"
      ] ?? "",
  });
  const current = options.find((option) => option.value === currentValue);
  const Icon = isText ? Type : Palette;
  const label = isText ? "Text colour" : "Text highlight";

  function setColor(value: string | null) {
    if (!editor) return;
    const attributes = editor.getAttributes("textStyle");
    editor
      .chain()
      .focus()
      .setMark("textStyle", {
        ...attributes,
        [isText ? "color" : "backgroundColor"]: value,
      })
      .run();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          disabled={!editor}
          className={cn(
            "h-8 gap-1.5 px-2",
            current && "bg-surface-selected text-primary",
          )}
        >
          <Icon
            className="size-4"
            aria-hidden
            style={current ? { color: current.value } : undefined}
          />
          <span>{current?.label ?? label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44 p-1">
        <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
          {label}
        </div>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setColor(option.value)}
            className="gap-2"
          >
            <span
              aria-hidden
              className="border-border size-4 shrink-0 rounded-sm border"
              style={{ backgroundColor: option.value }}
            />
            <span className="flex-1">{option.label}</span>
            {currentValue === option.value ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setColor(null)} className="gap-2">
          <span className="border-border text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px]">
            ×
          </span>
          Clear {isText ? "colour" : "highlight"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TablePicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const maxRows = 8;
  const maxCols = 10;

  function insertTable(rows: number, cols: number) {
    if (!editor || rows < 1 || cols < 1) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setOpen(false);
    setHovered({ rows: 0, cols: 0 });
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setHovered({ rows: 0, cols: 0 });
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Insert table"
          title="Insert table"
          disabled={!editor}
        >
          <Table2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[13.5rem] p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-xs">
          <span>Select table size</span>
          <span className="text-foreground font-medium tabular-nums">
            {hovered.rows}×{hovered.cols}
          </span>
        </div>
        <div
          role="grid"
          aria-label="Table size"
          className="border-border grid grid-cols-10 overflow-hidden rounded-sm border"
          onPointerDown={(event) => event.preventDefault()}
          onPointerLeave={() => setHovered({ rows: 0, cols: 0 })}
        >
          {Array.from({ length: maxRows * maxCols }, (_, index) => {
            const row = Math.floor(index / maxCols) + 1;
            const col = (index % maxCols) + 1;
            const selected = row <= hovered.rows && col <= hovered.cols;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                aria-label={`${row} rows by ${col} columns`}
                className={cn(
                  "border-border h-5 w-5 border-r border-b transition-colors duration-100 last:border-r-0",
                  "hover:bg-primary-subtle hover:border-primary focus-visible:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
                  selected && "bg-primary-subtle border-primary",
                )}
                onPointerEnter={() => setHovered({ rows: row, cols: col })}
                onClick={() => insertTable(row, col)}
              />
            );
          })}
        </div>
        <p className="text-muted-foreground mt-2 px-1 text-[11px]">
          Click a cell to insert
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CellColorMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState("#ffffff");

  function setCellColor(value: string | null) {
    editor?.chain().focus().setCellAttribute("backgroundColor", value).run();
    setOpen(false);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Cell colour"
          title="Cell colour"
          disabled={!editor}
          className="h-8 gap-1.5 px-2"
        >
          <Palette className="size-4" aria-hidden />
          <span>Cell colour</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 p-2"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("label, input")) event.preventDefault();
        }}
      >
        <div className="text-muted-foreground mb-2 px-1 text-[11px] font-semibold tracking-wide uppercase">
          Cell colour
        </div>
        <div
          role="grid"
          aria-label="Cell colour palette"
          className="grid grid-cols-5 overflow-hidden rounded-sm"
        >
          {cellColorOptions.map((color, index) => (
            <button
              key={`${color}-${index}`}
              type="button"
              role="gridcell"
              aria-label={`Cell colour ${index + 1}`}
              title={`Cell colour ${index + 1}`}
              className="border-surface size-9 border transition-transform duration-100 hover:z-10 hover:scale-110 hover:rounded-sm focus-visible:ring-ring focus-visible:z-10 focus-visible:scale-110 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              style={{ backgroundColor: color }}
              onClick={() => setCellColor(color)}
            />
          ))}
        </div>
        <div className="border-border mt-2 flex items-center justify-between border-t pt-2">
          <button
            type="button"
            aria-label="Clear cell colour"
            title="Clear cell colour"
            className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-8 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => setCellColor(null)}
          >
            <span aria-hidden className="text-base leading-none">
              ×
            </span>
          </button>
          <label
            title="Custom cell colour"
            className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-within:ring-ring relative flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 focus-within:ring-2"
          >
            <Palette className="size-4" aria-hidden />
            <input
              type="color"
              aria-label="Custom cell colour"
              value={customColor}
              onChange={(event) => {
                setCustomColor(event.target.value);
                setCellColor(event.target.value);
              }}
              className="sr-only"
            />
          </label>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableActionButton({
  editor,
  label,
  onClick,
  children,
}: {
  editor: Editor | null;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      disabled={!editor}
      onClick={onClick}
      className="h-8 gap-1.5 px-2"
    >
      {children}
      <span>{label}</span>
    </Button>
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
      <TableActionButton
        editor={editor}
        label="Add row"
        onClick={() => editor?.chain().focus().addRowAfter().run()}
      >
        <Rows3 />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Add column"
        onClick={() => editor?.chain().focus().addColumnAfter().run()}
      >
        <Columns3 />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Delete row"
        onClick={() => editor?.chain().focus().deleteRow().run()}
      >
        <Rows3 />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Delete column"
        onClick={() => editor?.chain().focus().deleteColumn().run()}
      >
        <Columns3 />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Merge selected cells"
        onClick={() => editor?.chain().focus().mergeCells().run()}
      >
        <TableCellsMerge />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Split cell"
        onClick={() => editor?.chain().focus().splitCell().run()}
      >
        <SquareSplitHorizontal />
      </TableActionButton>
      <CellColorMenu editor={editor} />
      <TableActionButton
        editor={editor}
        label="Delete table"
        onClick={() => editor?.chain().focus().deleteTable().run()}
      >
        <Trash2 />
      </TableActionButton>
    </div>
  );
}

function RichTextToolbar({ editor }: { editor: Editor | null }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkTarget, setLinkTarget] = useState("_self");
  const linkSelection = useRef<{ from: number; to: number } | null>(null);

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const attributes = editor.getAttributes("link");
    linkSelection.current = { from, to };
    setLinkUrl((attributes.href as string | undefined) ?? "");
    setLinkTitle((attributes.title as string | undefined) ?? "");
    setLinkTarget((attributes.target as string | undefined) ?? "_self");
    setLinkText(editor.state.doc.textBetween(from, to, " "));
    setLinkOpen(true);
  }

  function saveLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    const href = linkUrl.trim();
    const selection = linkSelection.current;
    if (selection) editor.commands.setTextSelection(selection);
    if (!href) {
      editor.chain().focus().unsetLink().run();
      setLinkOpen(false);
      return;
    }

    const attrs = {
      href,
      title: linkTitle.trim() || null,
      target: linkTarget === "_blank" ? "_blank" : null,
    };
    const displayText = linkText.trim() || href;
    const chain = editor.chain().focus();
    if (selection && selection.from !== selection.to) {
      const selectedText = editor.state.doc.textBetween(
        selection.from,
        selection.to,
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
        label="Underline"
        active={editor?.isActive("underline")}
        onClick={() => editor?.chain().focus().toggleMark("underline").run()}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Strikethrough"
        active={editor?.isActive("strike")}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label="Inline code"
        active={editor?.isActive("code")}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code2 />
      </ToolbarButton>
      <ColorMenu editor={editor} kind="text" />
      <ColorMenu editor={editor} kind="highlight" />
      <ToolbarButton
        editor={editor}
        label="Clear text colour and highlight"
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
            editor.view.dispatch(editor.state.tr.removeMark(from, to, markType));
            editor.view.focus();
          }
        }}
      >
        <RemoveFormatting />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <HeadingMenu editor={editor} />
      <AlignmentMenu editor={editor} />
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
      <ToolbarButton
        editor={editor}
        label="Insert divider"
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <ToolbarButton editor={editor} label="Add link" onClick={openLinkDialog}>
        <Link2 />
      </ToolbarButton>
      <ToolbarButton editor={editor} label="Insert image" onClick={insertImage}>
        <ImagePlus />
      </ToolbarButton>
      <span aria-hidden className="bg-border mx-1 h-5 w-px" />
      <TablePicker editor={editor} />
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
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent title="Chèn/sửa liên kết" className="max-w-xl">
          <form onSubmit={saveLink} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="link-url" className="text-sm font-medium">
                Url
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
                Nội dung hiển thị
              </label>
              <Input
                id="link-text"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder="Text shown to readers"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-title" className="text-sm font-medium">
                Tiêu đề
              </label>
              <Input
                id="link-title"
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder="Không bắt buộc"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-target" className="text-sm font-medium">
                Open link in...
              </label>
              <select
                id="link-target"
                value={linkTarget}
                onChange={(event) => setLinkTarget(event.target.value)}
                className="border-border bg-surface h-9 w-full rounded-md border px-3 text-sm transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-border-strong focus-visible:ring-ring focus-visible:border-border-strong focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="_self">Current window</option>
                <option value="_blank">New window</option>
              </select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLinkOpen(false)}
              >
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary">
                Lưu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
      {editor ? (
        <RichTextToolbar editor={editor} />
      ) : (
        <div
          className="border-border bg-surface-sunken h-10 rounded-t-md border"
          aria-hidden
        />
      )}
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
    () => linkifyPlainTextUrls(normalizeConfluenceCodeMacros(content)),
    [content],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: editorExtensions,
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

  return <EditorContent editor={editor} />;
}

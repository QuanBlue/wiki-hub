"use client";

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Code2,
  FilePlus2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Info,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  Table2,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

// Notion-style "/" menu: type "/" anywhere a plain character could go, a
// filterable list of insertable blocks pops up under the caret, arrow keys +
// Enter (or a click) inserts the chosen block and removes the typed
// "/query". Every item's `run` is a one-line call into the exact command the
// fixed toolbar already uses for that block - the menu is a second way to
// reach the same insertion logic, never a second implementation of it.

/**
 * A reusable preview mockup key, not a per-item bespoke snippet - most items
 * of the same shape (three heading levels, four callout colours) share one
 * renderer with different props, matching how CalloutComponent's colour
 * switch already keys off `type` instead of four near-duplicate components.
 */
export type SlashPreviewKind =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "bulletList"
  | "numberedList"
  | "todoList"
  | "toggleList"
  | "quote"
  | "divider"
  | "codeBlock"
  | "table"
  | "callout"
  | "image"
  | "attachment"
  | "linkToPage"
  | "createSubpage";

export type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  group: string;
  run: (editor: Editor) => void;
  /**
   * The markdown-style trigger shown as a hint next to this row (e.g. "#",
   * ">", "[]"), for items backed by an input rule that's already active
   * (StarterKit defaults, or TaskItem's). Left unset for items with no
   * natural single-shortcut equivalent (Table, callouts, Image, Attachment)
   * - matching Notion's own menu, which only shows a hint where one
   * genuinely exists. Purely informational: typing the shortcut works
   * because the underlying node's input rule is already registered in
   * editorExtensions, not because of anything in this file.
   */
  shortcut?: string;
  /** Which mockup SlashCommandPreview renders for the highlighted row. */
  preview: SlashPreviewKind;
  /** Only read for preview: "callout" items pass their CalloutType through. */
  previewCalloutType?: CalloutType;
};

type CalloutType = "info" | "warning" | "tip" | "panel";

// Matches CalloutComponent's own type -> icon mapping (rich-text-editor.tsx)
// exactly, so a callout looks the same whether it arrived via this menu or
// (today, only) a Confluence import.
const CALLOUT_ICONS: Record<CalloutType, LucideIcon> = {
  info: AlertCircle,
  warning: AlertTriangle,
  tip: Lightbulb,
  panel: Info,
};

function insertCallout(editor: Editor, type: CalloutType) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "callout",
      attrs: { type },
      content: [{ type: "paragraph" }],
    })
    .run();
}

// insertContent's default post-insert selection lands at the very end of
// what it inserted - the empty body paragraph, not the title - so typing
// right after inserting a toggle would silently fill in the body instead of
// naming it. Also exported for rich-text-editor.tsx's own ">" input rule,
// which hits the exact same problem.
//
// `nearPos` is only a *search anchor*, not the toggle's actual position:
// when a block-group node like "toggle" is inserted at a text position
// inside an (often empty) paragraph, ProseMirror's own content-fitting
// promotes it up to wherever it structurally fits - frequently NOT the
// same offset the selection sat at beforehand (confirmed by logging: a
// toggle typed at the very start of an empty paragraph landed at position
// 0, one before the naively-assumed range.from of 1). Searching the actual
// post-insert doc for the nearest "toggle" node is the only reliable way
// to find where to place the cursor.
export function placeCursorInToggleSummary(
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  nearPos: number,
) {
  if (!dispatch) return true;
  let togglePos = -1;
  tr.doc.nodesBetween(
    Math.max(0, nearPos - 1),
    tr.doc.content.size,
    (node, pos) => {
      if (togglePos !== -1) return false;
      if (node.type.name === "toggle") {
        togglePos = pos;
        return false;
      }
      return true;
    },
  );
  if (togglePos === -1) return true;
  // togglePos: before the toggle node. +1 steps inside it (before its
  // first child, toggleSummary); +1 more steps inside that child's own
  // inline content. TextSelection.near (not the plain setTextSelection
  // command) clamps to the nearest valid inline position instead of
  // warning and refusing to select if this is ever off by one.
  const pos = Math.min(togglePos + 2, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos), 1));
  return true;
}

// Exported so the fixed toolbar's own "Toggle list" button (rich-text-editor.tsx)
// inserts a toggle exactly the same way the slash menu's "Toggle list" row
// does, rather than re-implementing the same insertContent shape twice.
export function insertToggle(editor: Editor) {
  const insertPos = editor.state.selection.from;
  editor
    .chain()
    .focus()
    .insertContent({
      type: "toggle",
      attrs: { open: true },
      content: [
        { type: "toggleSummary" },
        { type: "toggleContent", content: [{ type: "paragraph" }] },
      ],
    })
    .command(({ tr, dispatch }) =>
      placeCursorInToggleSummary(tr, dispatch, insertPos),
    )
    .run();
}

// Image/attachment insertion needs the hidden file input + upload flow that
// RichTextToolbar already owns (upload state, error handling, the
// onUploadFile prop). Rather than threading that through this
// editor-instance-agnostic extension, dispatch the same kind of DOM
// CustomEvent this file already uses elsewhere ("wikihub:view-file-details")
// for "a node view needs to trigger a toolbar-owned action" - RichTextToolbar
// listens and calls its own insertImage()/insertAttachment().
function requestFilePicker(kind: "image" | "attachment") {
  document.dispatchEvent(new CustomEvent(`wikihub:slash-insert-${kind}`));
}

// Same CustomEvent bridge as requestFilePicker above, for the two items that
// need real page data (a page picker fetched from the space's API, or a new
// page created through it) that only RichTextToolbar has the spaceKey/
// currentPageId/router context for (see its pageLinkContext prop).
function requestPageAction(kind: "link-to-page" | "create-subpage") {
  document.dispatchEvent(new CustomEvent(`wikihub:slash-${kind}`));
}

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "text",
    label: "Text",
    description: "Plain paragraph text",
    keywords: ["paragraph", "p"],
    icon: Pilcrow,
    group: "Basic blocks",
    preview: "text",
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title"],
    icon: Heading1,
    group: "Basic blocks",
    shortcut: "#",
    preview: "heading1",
    run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "subtitle"],
    icon: Heading2,
    group: "Basic blocks",
    shortcut: "##",
    preview: "heading2",
    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    keywords: ["h3"],
    icon: Heading3,
    group: "Basic blocks",
    shortcut: "###",
    preview: "heading3",
    run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "heading-4",
    label: "Heading 4",
    description: "Extra-small section heading",
    keywords: ["h4"],
    icon: Heading4,
    group: "Basic blocks",
    shortcut: "####",
    preview: "heading4",
    run: (editor) => editor.chain().focus().setHeading({ level: 4 }).run(),
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    description: "Simple unordered list",
    keywords: ["ul", "bullet", "list"],
    icon: List,
    group: "Basic blocks",
    shortcut: "-",
    preview: "bulletList",
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    description: "Ordered list with numbers",
    keywords: ["ol", "ordered", "list"],
    icon: ListOrdered,
    group: "Basic blocks",
    shortcut: "1.",
    preview: "numberedList",
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "todo-list",
    label: "To-do list",
    description: "Checklist with checkboxes",
    keywords: ["todo", "task", "checkbox", "checklist"],
    icon: ListTodo,
    group: "Basic blocks",
    shortcut: "[]",
    preview: "todoList",
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "toggle-list",
    label: "Toggle list",
    description: "Collapsible content",
    keywords: ["toggle", "collapse", "details", "expand"],
    icon: ChevronRight,
    group: "Basic blocks",
    shortcut: ">",
    preview: "toggleList",
    run: (editor) => insertToggle(editor),
  },
  {
    id: "quote",
    label: "Quote",
    description: "Capture a quotation",
    keywords: ["blockquote"],
    icon: Quote,
    group: "Basic blocks",
    shortcut: '"',
    preview: "quote",
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Visually separate content",
    keywords: ["hr", "horizontal rule", "line"],
    icon: Minus,
    group: "Basic blocks",
    shortcut: "---",
    preview: "divider",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "code-block",
    label: "Code block",
    description: "A snippet with syntax colours",
    keywords: ["code", "snippet"],
    icon: Code2,
    group: "Code",
    shortcut: "```",
    preview: "codeBlock",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    label: "Table",
    description: "3×3 table with a header row",
    keywords: ["grid"],
    icon: Table2,
    group: "Layout",
    preview: "table",
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "callout-info",
    label: "Callout: Info",
    description: "Highlight information",
    keywords: ["callout", "note", "blue"],
    icon: CALLOUT_ICONS.info,
    group: "Layout",
    preview: "callout",
    previewCalloutType: "info",
    run: (editor) => insertCallout(editor, "info"),
  },
  {
    id: "callout-warning",
    label: "Callout: Warning",
    description: "Highlight a warning",
    keywords: ["callout", "warning", "amber"],
    icon: CALLOUT_ICONS.warning,
    group: "Layout",
    preview: "callout",
    previewCalloutType: "warning",
    run: (editor) => insertCallout(editor, "warning"),
  },
  {
    id: "callout-tip",
    label: "Callout: Tip",
    description: "Highlight a helpful tip",
    keywords: ["callout", "tip", "emerald"],
    icon: CALLOUT_ICONS.tip,
    group: "Layout",
    preview: "callout",
    previewCalloutType: "tip",
    run: (editor) => insertCallout(editor, "tip"),
  },
  {
    id: "callout-panel",
    label: "Callout: Panel",
    description: "Neutral highlighted panel",
    keywords: ["callout", "panel"],
    icon: CALLOUT_ICONS.panel,
    group: "Layout",
    preview: "callout",
    previewCalloutType: "panel",
    run: (editor) => insertCallout(editor, "panel"),
  },
  {
    id: "image",
    label: "Image",
    description: "Upload and embed an image",
    keywords: ["picture", "photo", "upload"],
    icon: ImagePlus,
    group: "Media",
    preview: "image",
    run: () => requestFilePicker("image"),
  },
  {
    id: "attachment",
    label: "Attachment",
    description: "Upload any file",
    keywords: ["file", "upload"],
    icon: Paperclip,
    group: "Media",
    preview: "attachment",
    run: () => requestFilePicker("attachment"),
  },
  {
    id: "link-to-page",
    label: "Link to page",
    description: "Search this space and link to a page",
    keywords: ["link", "page", "reference", "mention"],
    icon: Link2,
    group: "Links",
    preview: "linkToPage",
    run: () => requestPageAction("link-to-page"),
  },
  {
    id: "create-subpage",
    label: "Create sub-page",
    description: "New page nested under this one",
    keywords: ["subpage", "child", "page", "new"],
    icon: FilePlus2,
    group: "Links",
    preview: "createSubpage",
    run: () => requestPageAction("create-subpage"),
  },
];

/** Same case-insensitive substring match move-page-dialog.tsx already uses
 * for its parent-page picker - a second use of the one filtering idiom this
 * app has, not a new one. */
export function filterSlashCommandItems(query: string): SlashCommandItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SLASH_COMMAND_ITEMS;
  return SLASH_COMMAND_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(normalized) ||
      item.keywords.some((keyword) =>
        keyword.toLowerCase().includes(normalized),
      ),
  );
}

// Matches CalloutComponent's own colour scheme (rich-text-editor.tsx) so the
// preview never promises a colour the inserted block won't actually have -
// picked out in isolation here because the preview card is always dark
// (Notion's own preview stays dark regardless of the app's theme), while
// CalloutComponent's classes are theme-aware and unsuitable to reuse as-is.
const PREVIEW_CALLOUT_COLORS: Record<
  CalloutType,
  { bar: string; text: string }
> = {
  info: { bar: "bg-blue-400", text: "text-blue-300" },
  warning: { bar: "bg-amber-400", text: "text-amber-300" },
  tip: { bar: "bg-emerald-400", text: "text-emerald-300" },
  panel: { bar: "bg-neutral-400", text: "text-neutral-300" },
};

/** The mockup half of the hover/selection preview - SlashCommandPreview below
 * wraps this with the dark card chrome and the caption line. */
function PreviewMockup({
  kind,
  calloutType,
}: {
  kind: SlashPreviewKind;
  calloutType: CalloutType;
}) {
  switch (kind) {
    case "text":
      return (
        <p className="text-sm leading-relaxed text-neutral-200">
          To be the <em>foremost</em> driver of civilization, pioneering the
          latest breakthroughs to propel society toward the perfection of{" "}
          <em>science and art</em>.
        </p>
      );
    case "heading1":
      return <p className="text-xl font-bold text-neutral-100">Heading 1</p>;
    case "heading2":
      return (
        <p className="text-lg font-semibold text-neutral-100">Heading 2</p>
      );
    case "heading3":
      return (
        <p className="text-base font-semibold text-neutral-100">Heading 3</p>
      );
    case "heading4":
      return (
        <p className="text-sm font-semibold text-neutral-100">Heading 4</p>
      );
    case "bulletList":
      return (
        <ul className="list-disc space-y-1 pl-4 text-sm text-neutral-200">
          <li>First item</li>
          <li>Second item</li>
        </ul>
      );
    case "numberedList":
      return (
        <ol className="list-decimal space-y-1 pl-4 text-sm text-neutral-200">
          <li>First item</li>
          <li>Second item</li>
        </ol>
      );
    case "todoList":
      return (
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2 text-neutral-500 line-through">
            <input
              type="checkbox"
              checked
              readOnly
              className="accent-neutral-500"
            />
            Done already
          </label>
          <label className="flex items-center gap-2 text-neutral-200">
            <input type="checkbox" readOnly className="accent-neutral-200" />
            Still to do
          </label>
        </div>
      );
    case "toggleList":
      return (
        <div className="text-sm text-neutral-200">
          <div className="flex items-center gap-1 font-medium">
            <ChevronRight className="size-3.5 text-neutral-400" aria-hidden />
            Toggle title
          </div>
          <p className="mt-1 pl-4 text-neutral-400">Hidden until opened</p>
        </div>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-neutral-500 pl-3 text-sm text-neutral-300 italic">
          A quotation worth remembering.
        </blockquote>
      );
    case "divider":
      return <hr className="border-neutral-700" />;
    case "codeBlock":
      return (
        <pre className="rounded bg-neutral-800 p-2 font-mono text-xs text-neutral-300">
          const answer = 42;
        </pre>
      );
    case "table":
      return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-700 bg-neutral-700 text-xs text-neutral-200">
          {["Name", "Status", "Ada", "Done"].map((cell, index) => (
            <div
              key={index}
              className={cn(
                "bg-neutral-800 px-2 py-1",
                index < 2 && "font-medium text-neutral-100",
              )}
            >
              {cell}
            </div>
          ))}
        </div>
      );
    case "callout": {
      const colors = PREVIEW_CALLOUT_COLORS[calloutType];
      return (
        <div className="flex items-start gap-2 rounded bg-neutral-800 p-2">
          <div
            className={cn("mt-0.5 h-3.5 w-1 shrink-0 rounded-full", colors.bar)}
          />
          <p className={cn("text-sm", colors.text)}>
            Something worth noticing.
          </p>
        </div>
      );
    }
    case "image":
      return (
        <div className="flex h-16 items-center justify-center rounded bg-neutral-800 text-neutral-500">
          <ImagePlus className="size-6" aria-hidden />
        </div>
      );
    case "attachment":
      return (
        <div className="flex items-center gap-2 rounded bg-neutral-800 p-2 text-sm text-neutral-300">
          <Paperclip className="size-4 shrink-0 text-neutral-500" aria-hidden />
          report.pdf
        </div>
      );
    case "linkToPage":
      return (
        <div className="flex items-center gap-2 rounded bg-neutral-800 p-2 text-sm">
          <FileText className="size-4 shrink-0 text-neutral-500" aria-hidden />
          <span className="text-blue-400 underline underline-offset-2">
            Onboarding guide
          </span>
        </div>
      );
    case "createSubpage":
      return (
        <div className="flex items-center gap-2 rounded bg-neutral-800 p-2 text-sm text-neutral-300">
          <FilePlus2 className="size-4 shrink-0 text-neutral-500" aria-hidden />
          Untitled
        </div>
      );
  }
}

/**
 * The floating dark card next to the highlighted row (see the Notion
 * screenshot this whole menu is modelled on) - a mockup of what the block
 * looks like plus its one-line description, which the row itself no longer
 * shows now that rows are icon+label+shortcut only.
 */
function SlashCommandPreview({ item }: { item: SlashCommandItem }) {
  return (
    <div className="w-56 rounded-md border border-neutral-700 bg-neutral-900 p-3 shadow-lg">
      <div className="pointer-events-none flex min-h-16 items-center">
        <div className="w-full">
          <PreviewMockup
            kind={item.preview}
            calloutType={item.previewCalloutType ?? "info"}
          />
        </div>
      </div>
      <p className="mt-2 border-t border-neutral-700 pt-2 text-xs text-neutral-400">
        {item.description}
      </p>
    </div>
  );
}

export type SlashCommandListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type SlashCommandListProps = {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
};

/**
 * The popup list. Deliberately not built on `cmdk` (installed, unused
 * elsewhere): `cmdk`'s `Command` root expects real DOM focus/keydown on
 * itself, but the whole point of a Suggestion-driven menu is that focus
 * never leaves the ProseMirror contenteditable while typing - the popup is
 * non-focusable, and `onKeyDown` below is called directly by the Suggestion
 * plugin's own keydown interception instead. Matches the `role="listbox"` /
 * `role="option"` combobox already established in move-page-dialog.tsx.
 */
export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [previewSide, setPreviewSide] = useState<"left" | "right">("right");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-derive the highlighted row whenever the filtered item set changes, same pattern move-page-dialog.tsx already uses for resetting on prop change
    setSelectedIndex(0);
  }, [items]);

  // Arrow keys move selectedIndex without ever moving the mouse or scrolling
  // the list on their own - keep the highlighted row in view as it walks
  // past either edge of the scrollable area.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Same clamp-to-viewport idea as TableActionsMenu's own positioning, just
  // for one edge: the preview card floats off the menu's right side by
  // default, and flips to the left only when there isn't room, rather than
  // running off screen.
  useLayoutEffect(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const previewWidth = 224 + 16; // w-56 card + the ml-2/mr-2 gap
    setPreviewSide(
      rect.right + previewWidth > window.innerWidth ? "left" : "right",
    );
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelectedIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelectedIndex(
          (current) => (current - 1 + items.length) % items.length,
        );
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  const groups = useMemo(() => {
    const byGroup = new Map<string, SlashCommandItem[]>();
    for (const item of items) {
      const group = byGroup.get(item.group) ?? [];
      group.push(item);
      byGroup.set(item.group, group);
    }
    return [...byGroup.entries()];
  }, [items]);

  // The kbd classes below match the existing convention in
  // search-modal.tsx (the "ESC" input hint and the footer nav hints) - same
  // border-border/rounded/font-mono shape, reused rather than invented.
  const footer = (
    <div className="border-border text-muted-foreground flex shrink-0 items-center justify-between border-t px-2 py-1.5 text-xs">
      <span>Close menu</span>
      <kbd className="border-border bg-surface rounded border px-1.5 py-0.5 font-mono">
        Esc
      </kbd>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface-raised flex w-72 flex-col rounded-md border shadow-lg">
        <p className="text-muted-foreground px-3 py-1.5 text-sm">
          No matching blocks.
        </p>
        {footer}
      </div>
    );
  }

  let flatIndex = -1;
  const selectedItem = items[selectedIndex];

  return (
    <div
      ref={wrapperRef}
      className="border-border bg-surface-raised relative flex max-h-80 w-72 flex-col rounded-md border shadow-lg"
    >
      {selectedItem ? (
        <div
          className={cn(
            "absolute top-0",
            previewSide === "right" ? "left-full ml-2" : "right-full mr-2",
          )}
        >
          <SlashCommandPreview item={selectedItem} />
        </div>
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Insert a block"
        className="flex-1 overflow-y-auto p-1"
      >
        {groups.map(([group, groupItems]) => (
          <div key={group}>
            <p className="text-muted-foreground px-2 pt-1.5 pb-1 text-xs font-medium tracking-wide uppercase">
              {group}
            </p>
            {groupItems.map((item) => {
              flatIndex += 1;
              const isSelected = flatIndex === selectedIndex;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={flatIndex}
                  // The list never takes DOM focus (see the component doc
                  // comment above) - without this, a click would first blur
                  // the editor, which clears the ProseMirror selection the
                  // Suggestion plugin's deleteRange(range) needs to still be
                  // valid for.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelectedIndex(flatIndex)}
                  onClick={() => command(item)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none",
                    isSelected
                      ? "bg-surface-selected text-foreground"
                      : "text-foreground hover:bg-surface-hover",
                  )}
                >
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {item.label}
                  </span>
                  {item.shortcut ? (
                    <kbd className="border-border text-muted-foreground bg-surface shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs">
                      {item.shortcut}
                    </kbd>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
});

type SlashHintState = { to: number; query: string } | null;

const slashHintPluginKey = new PluginKey<SlashHintState>("slashCommandHint");

/**
 * The faint "Type to search" hint shown right after the typed "/" while the
 * menu is open and nothing has been typed to filter it yet - a separate
 * plugin (not part of the Suggestion() config below, which has no hook for
 * arbitrary widget content) whose own state is kept in sync from the
 * render() lifecycle beside it, via updateSlashHint().
 */
function createSlashHintPlugin() {
  return new Plugin<SlashHintState>({
    key: slashHintPluginKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(slashHintPluginKey);
        return meta !== undefined ? meta : prev;
      },
    },
    props: {
      decorations(state) {
        const value = slashHintPluginKey.getState(state);
        if (!value || value.query) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            value.to,
            () => {
              const span = document.createElement("span");
              span.textContent = "Type to search";
              span.className = "text-muted-foreground text-sm";
              span.contentEditable = "false";
              return span;
            },
            { side: 1 },
          ),
        ]);
      },
    },
  });
}

function slashHintValuesEqual(a: SlashHintState, b: SlashHintState) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.to === b.to && a.query === b.query;
}

// Re-dispatching every keystroke would fight with Suggestion's own
// transaction for the same event and could loop (this plugin's apply runs
// on that follow-up dispatch too, which re-triggers Suggestion's onUpdate);
// only actually dispatch when the value would change.
function updateSlashHint(editor: Editor, value: SlashHintState) {
  const current = slashHintPluginKey.getState(editor.state) ?? null;
  if (slashHintValuesEqual(current, value)) return;
  editor.view.dispatch(editor.state.tr.setMeta(slashHintPluginKey, value));
}

/**
 * Wires `@tiptap/suggestion` (the Tiptap-maintained utility behind
 * `/`-commands and `@`-mentions alike) to the item list above. Positioning
 * comes from `props.mount()`, Suggestion's own Floating-UI-backed anchor
 * that follows the cursor and re-clamps to the viewport automatically - no
 * manual `getBoundingClientRect`/clamp math to maintain.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      createSlashHintPlugin(),
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "/",
        items: ({ query }) => filterSlashCommandItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let component: ReactRenderer<
            SlashCommandListRef,
            SlashCommandListProps
          >;
          let unmount: (() => void) | null = null;

          return {
            onStart: (
              props: SuggestionProps<SlashCommandItem, SlashCommandItem>,
            ) => {
              component = new ReactRenderer<
                SlashCommandListRef,
                SlashCommandListProps
              >(SlashCommandList, {
                props: {
                  items: props.items,
                  command: (item: SlashCommandItem) => props.command(item),
                },
                editor: props.editor,
              });
              unmount = props.mount(component.element);
              updateSlashHint(props.editor, {
                to: props.range.to,
                query: props.query,
              });
            },
            onUpdate: (
              props: SuggestionProps<SlashCommandItem, SlashCommandItem>,
            ) => {
              component.updateProps({
                items: props.items,
                command: (item: SlashCommandItem) => props.command(item),
              });
              updateSlashHint(props.editor, {
                to: props.range.to,
                query: props.query,
              });
            },
            // Suggestion calls this for every key while the menu is open,
            // including Escape - it always exits the suggestion state after
            // (calling onExit below) regardless of this return value, so
            // there is nothing Escape-specific to do here.
            onKeyDown: (props: SuggestionKeyDownProps) =>
              component.ref?.onKeyDown(props) ?? false,
            onExit: (
              props: SuggestionProps<SlashCommandItem, SlashCommandItem>,
            ) => {
              unmount?.();
              unmount = null;
              component.destroy();
              updateSlashHint(props.editor, null);
            },
          };
        },
      }),
    ];
  },
});

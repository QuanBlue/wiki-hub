"use client";

import Heading from "@tiptap/extension-heading";
import Link from "@tiptap/extension-link";
import { ListItem } from "@tiptap/extension-list";
import Blockquote from "@tiptap/extension-blockquote";
import Code from "@tiptap/extension-code";
import {
  Extension,
  Node as TiptapNode,
  Mark,
  mergeAttributes,
  InputRule,
  wrappingInputRule,
} from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  useEditorState,
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Info,
  Lightbulb,
  ListTree,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { translate } from "@/lib/i18n/core";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { placeCursorInToggleSummary } from "@/components/pages/slash-command";
import { DiagramBlockComponent } from "@/components/pages/diagram-block";

import { ignoreNodeViewChrome } from "./content-normalize";

export const StyledListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => element.style.textAlign || null,
        renderHTML: (attributes) =>
          attributes.textAlign
            ? { style: `text-align: ${attributes.textAlign}` }
            : {},
      },
    };
  },
});

export const TextStyleMark = Mark.create({
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
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize || null,
        renderHTML: (attributes) =>
          attributes.fontSize
            ? { style: `font-size: ${attributes.fontSize}` }
            : {},
      },
      // Set by document import for a hand-aligned code sample or ASCII
      // diagram pulled out of a Word table: a proportional font gives each
      // character its own width, which drifts the very columns the import
      // just went to the trouble of preserving as non-breaking spaces.
      fontFamily: {
        default: null,
        parseHTML: (element) => element.style.fontFamily || null,
        renderHTML: (attributes) =>
          attributes.fontFamily
            ? { style: `font-family: ${attributes.fontFamily}` }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'span[style*="color"]' },
      { tag: 'span[style*="font-size"]' },
      { tag: 'span[style*="font-family"]' },
      { tag: "span[data-wikihub-text-style]" },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-wikihub-text-style": "" }),
      0,
    ];
  },
});

// A `<u>` has no colour of its own: the line is painted in the colour it
// inherits. StarterKit's stock Underline loads ahead of TextStyleMark, so a
// coloured, underlined run rendered as `<u><span color>` and the line stayed
// the default text colour while only the glyphs changed. The lower priority
// makes this the innermost mark (`<span color><u>`), so it inherits the colour.
export const UnderlineMark = Mark.create({
  name: "underline",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      "Mod-u": () => this.editor.commands.toggleMark(this.name),
      "Mod-U": () => this.editor.commands.toggleMark(this.name),
    };
  },
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
  },
});
function CalloutComponent({ node }: NodeViewProps) {
  const type = (node.attrs.type || "info").toLowerCase();

  const config = useMemo(() => {
    switch (type) {
      case "warning":
      case "note":
        return {
          bg: "bg-amber-500/10 border-amber-500/35 text-foreground dark:bg-amber-500/15",
          icon: AlertTriangle,
          iconColor: "text-amber-600 dark:text-amber-400",
        };
      case "tip":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/30 text-foreground dark:bg-emerald-500/15",
          icon: Lightbulb,
          iconColor: "text-emerald-600 dark:text-emerald-400",
        };
      case "panel":
        return {
          bg: "bg-surface-sunken border-border text-foreground",
          icon: Info,
          iconColor: "text-muted-foreground",
        };
      case "info":
      default:
        return {
          bg: "bg-blue-500/10 border-blue-500/30 text-foreground dark:bg-blue-500/15",
          icon: AlertCircle,
          iconColor: "text-blue-600 dark:text-blue-400",
        };
    }
  }, [type]);

  const IconComponent = config.icon;

  return (
    <NodeViewWrapper className="my-4">
      <div
        className={cn(
          "relative flex items-start gap-3 rounded-md border p-4 transition-colors",
          config.bg,
        )}
      >
        <div className="mt-0.5 flex-shrink-0 select-none">
          <IconComponent className={cn("h-5 w-5", config.iconColor)} />
        </div>
        <div className="min-w-0 flex-1 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

/**
 * The toggle/collapsible block. Its two children (toggleSummary,
 * toggleContent - see CustomToggleSummaryNode/CustomToggleContentNode below)
 * have no node views of their own and render via plain parseHTML/renderHTML,
 * so this is the only node view in the trio. `open` lives solely on this
 * (parent) node - toggleContent stays mounted in the document either way and
 * is only ever hidden with CSS, so nothing typed while collapsed is ever
 * lost, and there's no cross-node attribute write to keep in sync.
 */
function ToggleComponent({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;
  const { t } = useTranslation();

  return (
    <NodeViewWrapper className="my-1">
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-label={
            open ? t("editor.collapseToggle") : t("editor.expandToggle")
          }
          aria-expanded={open}
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => updateAttributes({ open: !open })}
          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded transition-colors duration-150"
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </button>
        <div
          className={cn(
            "min-w-0 flex-1 [&_[data-type='toggle-summary']]:font-medium [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
            !open && "[&_[data-type='toggle-content']]:hidden",
          )}
        >
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
// Notion's own markdown shortcuts use '" ' for Quote and '> ' for Toggle
// list, the opposite of Blockquote's stock '> ' input rule - re-key it here
// rather than in a second place, so there is exactly one source of truth for
// what triggers a blockquote.
export const CustomBlockquote = Blockquote.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*"\s$/,
        type: this.type,
      }),
    ];
  },
});
export const CustomCalloutNode = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element: HTMLElement) => {
          const dataType = element.getAttribute("data-callout-type");
          if (dataType) return dataType;
          const cls = element.className || "";
          if (/warning/i.test(cls)) return "warning";
          if (/note/i.test(cls)) return "note";
          if (/tip/i.test(cls)) return "tip";
          if (/panel/i.test(cls)) return "panel";
          return "info";
        },
        renderHTML: (attributes) => ({
          "data-callout-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="callout"]' },
      { tag: "div.callout" },
      { tag: "div.confluence-information-macro" },
      { tag: "blockquote.callout" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        class: `callout callout-${HTMLAttributes["data-callout-type"] || "info"}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent, { ignoreMutation: ignoreNodeViewChrome });
  },
});

// The toggle/collapsible block. No official @tiptap/extension-details
// install here: its companion -summary/-content packages are only published
// for Tiptap v2 (peer dep ^2.7.0, incompatible with the v3 core this app
// runs) or as an unreleased v3 beta (peer dep pinned to that exact beta) -
// installing either would be unsafe. This is a small hand-rolled
// equivalent, same three-node shape, following the same
// TiptapNode.create()/ReactNodeViewRenderer pattern as CustomCalloutNode
// above.
export const CustomToggleSummaryNode = TiptapNode.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary" }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      // The parent toggle's content expression is exactly "toggleSummary
      // toggleContent" (one of each, no repeats), so the default Enter
      // (splitBlock, which would try to create a second toggleSummary
      // sibling) is schema-invalid here. Move into the body instead - the
      // same "Enter escapes this node" idea TaskItem's own Enter override
      // already uses.
      Enter: () =>
        this.editor.commands.command(({ tr, dispatch, state }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== this.name) return false;
          // A summary only ever sits directly inside its toggle.
          const toggleDepth = $from.depth - 1;
          const summaryNode = $from.node(toggleDepth).firstChild!;
          const toggleStart = $from.before(toggleDepth);
          const contentStart = toggleStart + 1 + summaryNode.nodeSize + 1;
          if (dispatch) {
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(contentStart), 1),
            );
          }
          return true;
        }),
      // Backspace at the very start of the title line used to be a dead
      // end: ProseMirror's default joinBackward doesn't know how to merge
      // a fixed "toggleSummary toggleContent" shape into whatever comes
      // before it, so the toggle was stuck - no keyboard way to remove one.
      // Unwrap instead: the title becomes a plain paragraph, the body's own
      // blocks (if any) follow it, and an empty toggle collapses to exactly
      // the one empty paragraph you'd expect Backspace to leave behind.
      Backspace: () =>
        this.editor.commands.command(({ tr, dispatch, state }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== this.name) return false;
          if ($from.parentOffset !== 0) return false;
          const toggleDepth = $from.depth - 1;
          const toggleNode = $from.node(toggleDepth);
          const summaryNode = toggleNode.firstChild!;
          const contentNode = toggleNode.lastChild!;

          if (dispatch) {
            const toggleStart = $from.before(toggleDepth);
            const toggleEnd = toggleStart + toggleNode.nodeSize;
            const contentIsEmpty =
              contentNode.childCount === 1 &&
              contentNode.firstChild!.isTextblock &&
              contentNode.firstChild!.content.size === 0;
            const replacement = Fragment.fromArray([
              state.schema.nodes.paragraph.create(null, summaryNode.content),
              ...(contentIsEmpty ? [] : contentNode.content.content),
            ]);
            tr.replaceWith(toggleStart, toggleEnd, replacement);
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(toggleStart + 1), 1),
            );
          }
          return true;
        }),
    };
  },
});

export const CustomToggleContentNode = TiptapNode.create({
  name: "toggleContent",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-content" }),
      0,
    ];
  },
});

export const CustomToggleNode = TiptapNode.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-open") !== "false",
        renderHTML: (attributes: { open: boolean }) => ({
          "data-open": String(attributes.open),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle" }),
      0,
    ];
  },

  addInputRules() {
    // Not a wrappingInputRule: toggle's content is a fixed two-node
    // sequence (a summary, then a content block), not a plain "wrap this
    // paragraph" shape wrappingInputRule can build - so this builds the
    // same {toggleSummary, toggleContent} shape insertToggle() in
    // slash-command.tsx inserts, just triggered by typing instead of
    // picking it from the menu.
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ chain, range }) => {
          // Same "land in the empty title, not the body" fix insertToggle()
          // in slash-command.tsx needs - see placeCursorInToggleSummary's
          // own comment for why this can't just be a hardcoded offset from
          // range.from.
          chain()
            .deleteRange(range)
            .insertContent({
              type: "toggle",
              attrs: { open: true },
              content: [
                { type: "toggleSummary" },
                { type: "toggleContent", content: [{ type: "paragraph" }] },
              ],
            })
            .command(({ tr, dispatch }) =>
              placeCursorInToggleSummary(tr, dispatch, range.from),
            )
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleComponent, { ignoreMutation: ignoreNodeViewChrome });
  },
});

type TableOfContentsHeading = {
  level: number;
  pos: number;
  text: string;
};

type NumberedTableOfContentsHeading = TableOfContentsHeading & {
  index: string;
};

function numberTableOfContentsHeadings(
  headings: TableOfContentsHeading[],
): NumberedTableOfContentsHeading[] {
  const counters = Array.from({ length: 6 }, () => 0);

  return headings.map((heading) => {
    const level = Math.min(Math.max(heading.level, 1), counters.length);
    const counterIndex = level - 1;

    counters[counterIndex] += 1;
    counters.fill(0, level);

    // A document can start at a nested heading. Keep its displayed outline
    // meaningful instead of rendering a zero-valued parent (for example 0.1).
    for (let index = 0; index < counterIndex; index += 1) {
      if (counters[index] === 0) counters[index] = 1;
    }

    return {
      ...heading,
      level,
      index: counters.slice(0, level).join("."),
    };
  });
}

/**
 * The node stores only its position. Entries are derived from the current
 * headings, so this table of contents stays current as the document changes.
 */
function TableOfContentsComponent({ editor }: NodeViewProps) {
  const { t } = useTranslation();
  const headingSnapshot = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) return "[]";
      const headings: TableOfContentsHeading[] = [];
      currentEditor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          headings.push({
            level: Number(node.attrs.level) || 1,
            pos,
            text: node.textContent.trim() || "Untitled section",
          });
        }
      });
      return JSON.stringify(headings);
    },
  });
  const headings = useMemo<TableOfContentsHeading[]>(
    () => JSON.parse(headingSnapshot ?? "[]") as TableOfContentsHeading[],
    [headingSnapshot],
  );
  const numberedHeadings = useMemo(
    () => numberTableOfContentsHeadings(headings),
    [headings],
  );

  const goToHeading = useCallback(
    (position: number) => {
      const heading = editor.view.nodeDOM(position);
      if (heading instanceof HTMLElement) {
        heading.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [editor],
  );

  return (
    <NodeViewWrapper
      as="nav"
      aria-label={t("slash.tableOfContentsLabel")}
      className="border-border bg-surface-sunken my-4 rounded-md border px-4 py-3"
      contentEditable={false}
    >
      <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <ListTree className="text-muted-foreground size-4" aria-hidden />
        {t("slash.tableOfContentsLabel")}
      </div>
      {headings.length ? (
        <ol
          className="mt-2 list-none space-y-1 p-0"
          style={{ listStyleType: "none" }}
        >
          {numberedHeadings.map((heading) => (
            <li
              key={heading.pos}
              style={{
                listStyleType: "none",
                paddingLeft: `${(heading.level - 1) * 12}px`,
              }}
            >
              <button
                type="button"
                className="text-muted-foreground hover:text-primary focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-sm py-0.5 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => goToHeading(heading.pos)}
                title={heading.text}
              >
                <span className="shrink-0 tabular-nums">{heading.index}.</span>
                <span className="truncate">{heading.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">
          Add headings to build this list automatically.
        </p>
      )}
    </NodeViewWrapper>
  );
}

export const TableOfContentsNode = TiptapNode.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="tableOfContents"]' },
      { tag: 'nav[data-type="table-of-contents"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "nav",
      mergeAttributes(HTMLAttributes, {
        "data-type": "table-of-contents",
        "aria-label": "Table of contents",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsComponent);
  },
});

export const DiagramNode = TiptapNode.create({
  name: "diagram",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  priority: 150,

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          return (
            element.getAttribute("data-code") ||
            element.querySelector("code.language-mermaid")?.textContent ||
            element.querySelector("pre")?.textContent ||
            element.textContent ||
            ""
          );
        },
      },
      look: {
        default: "classic",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-look") || "classic",
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-caption") || null,
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const w = element.getAttribute("data-width");
          return w ? parseInt(w, 10) || null : null;
        },
      },
      alignment: {
        default: "center",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-alignment") || "center",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="diagram"]',
      },
      {
        tag: 'pre[data-type="diagram"]',
      },
      {
        tag: "pre > code.language-mermaid",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const code = HTMLAttributes.code || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "diagram",
        "data-engine": "mermaid",
        "data-look": HTMLAttributes.look || "classic",
        "data-caption": HTMLAttributes.caption || undefined,
        "data-width": HTMLAttributes.width || undefined,
        "data-alignment": HTMLAttributes.alignment || "center",
        "data-code": code,
      }),
      [
        "pre",
        { class: "mermaid-src hidden", style: "display:none" },
        ["code", { class: "language-mermaid" }, code],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramBlockComponent);
  },
});
const MAX_BLOCK_INDENT = 8;
const BLOCK_INDENT_REM = 2;
const INDENTABLE_TYPES = ["paragraph", "heading"];

/**
 * Tab / Shift-Tab indent paragraphs and headings by whole steps, stored as a
 * left margin so the reader and exports show it too. Deliberately the last in
 * line (low priority): code blocks, list items and table cells handle Tab
 * themselves first. Whatever reaches this handler is swallowed even when there
 * is nothing to indent, so Tab never throws keyboard focus out of the page body.
 */
/**
 * The hint on an empty line: how to reach AI and the / menu. It is drawn as a
 * widget instead of the placeholder's `content: attr(...)` so the keys can be
 * set in code type, which a single CSS string cannot do. The text comes from the
 * dictionary with the key names between backticks.
 */
function buildEmptyLineHint(): HTMLElement {
  const locale = document.documentElement.lang === "vi" ? "vi" : "en";
  const hint = document.createElement("span");
  hint.className =
    "wh-empty-line-hint pointer-events-none float-left h-0 text-muted-foreground opacity-60 select-none";
  translate(locale, "editor.aiPlaceholder")
    .split("`")
    .forEach((part, index) => {
      if (index % 2 === 1) {
        // A span, not <code>: the editor styles <code> in the inline-code red.
        const key = document.createElement("span");
        key.className =
          "bg-surface-sunken rounded px-1 py-0.5 font-mono text-xs";
        key.textContent = part;
        hint.appendChild(key);
      } else {
        hint.appendChild(document.createTextNode(part));
      }
    });
  return hint;
}

export const EmptyLineHint = Extension.create({
  name: "emptyLineHint",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (!editor.isEditable || !state.selection.empty) return null;
            const { $from } = state.selection;
            // Only a blank paragraph directly in the page - not in a table cell,
            // list or callout, where the line already has a job.
            if (
              $from.depth !== 1 ||
              $from.parent.type.name !== "paragraph" ||
              $from.parent.content.size !== 0
            ) {
              return null;
            }
            const locale = document.documentElement.lang === "vi" ? "vi" : "en";
            return DecorationSet.create(state.doc, [
              Decoration.widget($from.pos, buildEmptyLineHint, {
                side: -1,
                key: `empty-line-hint-${locale}`,
              }),
            ]);
          },
        },
      }),
    ];
  },
});

export const BlockIndent = Extension.create({
  name: "blockIndent",
  priority: 10,
  addGlobalAttributes() {
    return [
      {
        types: [...INDENTABLE_TYPES, "blockquote"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const match = /^(\d+(?:\.\d+)?)rem$/.exec(
                element.style.marginLeft,
              );
              if (!match) return 0;
              const level = Math.round(Number(match[1]) / BLOCK_INDENT_REM);
              return Math.min(Math.max(level, 0), MAX_BLOCK_INDENT);
            },
            renderHTML: (attributes: { indent?: number }) =>
              attributes.indent
                ? {
                    style: `margin-left: ${attributes.indent * BLOCK_INDENT_REM}rem`,
                  }
                : {},
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    const shift = (delta: 1 | -1) => () =>
      this.editor.commands.command(({ state, tr, dispatch }) => {
        const { $from, $to } = state.selection;

        // Tab on content sitting right under a quote (same level as the quote)
        // pulls it into that quote. A list only gets here when it cannot sink
        // any further, i.e. its first item is selected.
        if (delta === 1 && $from.depth > 0 && $to.depth > 0) {
          const start = $from.index(0);
          const previous = start > 0 ? state.doc.child(start - 1) : null;
          const topName = state.doc.child(start).type.name;
          if (
            previous?.type.name === "blockquote" &&
            [
              "paragraph",
              "heading",
              "bulletList",
              "orderedList",
              "taskList",
            ].includes(topName)
          ) {
            if (!dispatch) return true;
            const rangeStart = $from.before(1);
            const rangeEnd = $to.after(1);
            const quoteEnd = rangeStart - 1;
            tr.insert(quoteEnd, state.doc.slice(rangeStart, rangeEnd).content);
            tr.delete(tr.mapping.map(rangeStart), tr.mapping.map(rangeEnd));
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                quoteEnd + ($from.pos - rangeStart),
                quoteEnd + ($to.pos - rangeStart),
              ),
            );
            dispatch(tr.scrollIntoView());
            return true;
          }
        }

        // Shift-Tab on the last, un-indented line of a top-level quote lets it
        // back out below the quote (the reverse of the above).
        if (
          delta === -1 &&
          $from.depth === 2 &&
          $from.sameParent($to) &&
          $from.node(1).type.name === "blockquote" &&
          $from.parent.isTextblock &&
          !Number($from.parent.attrs.indent) &&
          $from.index(1) > 0 &&
          $from.index(1) === $from.node(1).childCount - 1
        ) {
          if (!dispatch) return true;
          const nodeStart = $from.before(2);
          const nodeEnd = $from.after(2);
          const quoteEnd = $from.after(1);
          const moved = $from.parent;
          tr.insert(quoteEnd, moved);
          tr.delete(nodeStart, nodeEnd);
          const newStart = quoteEnd - (nodeEnd - nodeStart);
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              newStart + ($from.pos - nodeStart),
              newStart + ($to.pos - nodeStart),
            ),
          );
          dispatch(tr.scrollIntoView());
          return true;
        }

        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const name = $from.node(depth).type.name;
          // Lists and tables own Tab; just keep focus in the editor.
          if (
            name === "listItem" ||
            name === "tableCell" ||
            name === "tableHeader"
          )
            return true;
        }
        if (!dispatch) return true;
        // A quote's first line indents the quote itself, not its paragraph, so
        // the vertical bar moves together with the text.
        const targets = new Map<number, PMNode>();
        state.doc.nodesBetween(
          state.selection.from,
          state.selection.to,
          (node, pos) => {
            if (!INDENTABLE_TYPES.includes(node.type.name)) return;
            const $pos = state.doc.resolve(pos);
            for (let depth = $pos.depth; depth > 0; depth -= 1) {
              if ($pos.node(depth).type.name === "blockquote") {
                // The bar sits where the quote's first line sits: only that
                // line moves the quote. Later lines indent on their own.
                if ($pos.index(depth) === 0) {
                  targets.set($pos.before(depth), $pos.node(depth));
                  return;
                }
                break;
              }
            }
            targets.set(pos, node);
          },
        );
        targets.forEach((node, pos) => {
          const current = Number(node.attrs.indent) || 0;
          const next = Math.min(Math.max(current + delta, 0), MAX_BLOCK_INDENT);
          if (next !== current)
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        });
        if (tr.docChanged) dispatch(tr.scrollIntoView());
        return true;
      });
    return { Tab: shift(1), "Shift-Tab": shift(-1) };
  },
});
// The stock Code mark has `excludes: "_"`, which forbids every other mark on
// the same text. Clearing it lets inline code be bold, italic, linked, etc.
export const InlineCode = Code.extend({ excludes: "" });
/**
 * A code block (or any node that isn't a paragraph) sitting first in the
 * document leaves no position "above" it for a cursor to land on - position
 * 0 is before the node structurally, but a leaf-content node like a code
 * block only accepts a cursor from position 1 onward, inside its own text.
 * A page that starts with a code block could otherwise never gain a line
 * above it. Pressing Up from that first position, or clicking in the blank
 * margin above the first node, opens one instead.
 */
export const LeadingParagraph = Extension.create({
  name: "leadingParagraph",
  addProseMirrorPlugins() {
    const editor = this.editor;
    function insertLeadingParagraph(view: EditorView) {
      const firstChild = view.state.doc.firstChild;
      if (!firstChild || firstChild.type.name === "paragraph") return false;
      const paragraph = view.state.schema.nodes.paragraph.create();
      const tr = view.state.tr.insert(0, paragraph);
      view.dispatch(
        tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView(),
      );
      return true;
    }
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (
              event.key !== "ArrowUp" ||
              !editor.isEditable ||
              !view.state.selection.empty ||
              view.state.selection.$from.pos !== 1
            ) {
              return false;
            }
            return insertLeadingParagraph(view);
          },
          handleClick(view, _pos, event) {
            if (!editor.isEditable) return false;
            const firstNodeDom = view.nodeDOM(0);
            if (!(firstNodeDom instanceof HTMLElement)) return false;
            if (event.clientY >= firstNodeDom.getBoundingClientRect().top) {
              return false;
            }
            return insertLeadingParagraph(view);
          },
        },
      }),
    ];
  },
});
// Diff markup is parsed by the same read-only editor as page content so node
// views (attachments, images, toggles, and code blocks) remain available.
export const DiffHighlightMark = Mark.create({
  name: "diffHighlight",
  excludes: "",

  addAttributes() {
    return {
      kind: {
        default: "add",
        parseHTML: (element) =>
          element.classList.contains("wh-diff-delete") ? "delete" : "add",
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark.wh-diff-add" }, { tag: "mark.wh-diff-delete" }];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "delete" ? "delete" : "add";
    return [
      "mark",
      { class: kind === "delete" ? "wh-diff-delete" : "wh-diff-add" },
      0,
    ];
  },
});

// A plain StarterKit heading has no `id` - fine for the live app (nothing
// ever links to one), but a static export's table of contents and any
// heading-anchor link need a real, stable id on the target itself, and the
// only place both the interactive editor and the read-only exported render
// share is this schema. Preserving an existing id (rather than only ever
// generating one) also means a heading id assigned server-side in
// prepare_export_html survives being parsed back into the editor for
// PDF/HTML capture instead of being silently dropped like any other
// attribute the schema doesn't know about.
// Every other link opens in a new tab by design (leaving the reader's place
// in the page intact) - but that is exactly wrong for a same-page anchor
// like a table-of-contents entry, which needs to jump *within* the current
// page. A new tab just shows a second copy of it, and is also what stops
// Chromium's PDF export from turning the link into an honest in-document
// jump rather than an external one. Link's target/rel are plain attribute
// defaults with no parseHTML of their own (see @tiptap/extension-link), so
// they apply to every link regardless of its href - this only strips them
// back off again for a "#..." href, once rendering.
export const AnchorAwareLink = Link.extend({
  renderHTML({ mark, HTMLAttributes }) {
    const rendered = this.parent!({ mark, HTMLAttributes }) as [
      string,
      Record<string, unknown>,
      number,
    ];
    if (!String(HTMLAttributes.href ?? "").startsWith("#")) return rendered;
    const { target: _target, rel: _rel, ...attrs } = rendered[1];
    return ["a", attrs, 0];
  },
});

export const HeadingWithId = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("id"),
        renderHTML: (attributes) =>
          attributes.id ? { id: attributes.id } : {},
      },
    };
  },
});

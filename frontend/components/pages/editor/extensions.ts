import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { translate } from "@/lib/i18n/core";
import { lowlight } from "@/lib/code-highlight";
import { SlashCommand } from "@/components/pages/slash-command";

import { AttachmentNode } from "./attachment-node";
import { CustomCodeBlock } from "./code-block";
import { headingLevels } from "./content-normalize";
import {
  AnchorAwareLink,
  BlockIndent,
  CustomBlockquote,
  CustomCalloutNode,
  CustomToggleContentNode,
  CustomToggleNode,
  CustomToggleSummaryNode,
  DiagramNode,
  DiffHighlightMark,
  EmptyLineHint,
  HeadingWithId,
  InlineCode,
  LeadingParagraph,
  StyledListItem,
  TableOfContentsNode,
  TextStyleMark,
  UnderlineMark,
} from "./custom-extensions";
import { ResizableImage } from "./resizable-image";
import {
  TABLE_CELL_MIN_WIDTH,
  TableCellDragSelection,
  TableCellTripleClick,
  TableCellWithBackground,
  TableColumnResize,
  TableHeaderWithBackground,
  TableRowResize,
  TableRowWithHeight,
} from "./table-extensions";

/**
 * Most of the schema is identical for the interactive editor and the
 * read-only render (`RichTextContent`) - only the image node differs.
 * `allowBase64` guards against a user pasting a giant inline image straight
 * into a document while editing, but a static export deliberately inlines
 * every attachment as a `data:` URI first (see export_content.py's
 * `_inline_attachments` - the headless browser that captures PDF/HTML/Word
 * exports has no session to fetch a normal attachment URL with), so the
 * same guard there just makes every exported image parse into nothing.
 */
type PlaceholderText = NonNullable<
  Parameters<typeof Placeholder.configure>[0]
>["placeholder"];

export function buildEditorExtensions({
  allowBase64 = false,
  placeholder,
}: { allowBase64?: boolean; placeholder?: PlaceholderText } = {}) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      // Replaced by InlineCode below, which lets bold/italic/etc. combine with it.
      code: false,
      listItem: false,
      // Replaced by UnderlineMark below, which controls the mark's nesting order.
      underline: false,
      // The stock drop cursor draws a rule across the whole block, which reads
      // like a horizontal divider rather than an insertion point. Styled down to
      // a caret in globals.css; the colour comes from there too.
      dropcursor: { class: "wikihub-dropcursor", width: 2, color: false },
    }),
    InlineCode,
    HeadingWithId.configure({ levels: [...headingLevels] }),
    CustomCodeBlock.configure({
      lowlight,
      // Also read by the LowlightPlugin's decoration pass as the fallback for
      // any block with a falsy language, so an untouched block stays
      // monochrome instead of `highlightAuto()` guessing its language.
      defaultLanguage: "plaintext",
    }),
    CustomBlockquote,
    LeadingParagraph,
    SlashCommand,
    CustomCalloutNode,
    CustomToggleSummaryNode,
    CustomToggleContentNode,
    CustomToggleNode,
    TableOfContentsNode,
    DiagramNode,
    StyledListItem,
    TaskList.configure({ HTMLAttributes: { class: "wikihub-task-list" } }),
    TaskItem.configure({ nested: true }),
    AnchorAwareLink.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    DiffHighlightMark,
    AttachmentNode,
    ResizableImage.configure({
      allowBase64,
    }),
    TextStyleMark,
    UnderlineMark,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    BlockIndent,
    EmptyLineHint,
    TableCellTripleClick,
    TableColumnResize,
    TableRowResize,
    TableCellDragSelection,
    Table.configure({
      resizable: false,
      cellMinWidth: TABLE_CELL_MIN_WIDTH,
    }),
    TableRowWithHeight,
    TableHeaderWithBackground,
    TableCellWithBackground,
    Placeholder.configure({
      placeholder: placeholder ?? translate("en", "editor.editorPlaceholder"),
    }),
  ];
}

// RichTextContent's read-only render: see buildEditorExtensions' own comment
// for why this one alone needs to accept a `data:` URI image.
export const readOnlyEditorExtensions = buildEditorExtensions({ allowBase64: true });

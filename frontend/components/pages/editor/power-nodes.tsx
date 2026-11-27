"use client";

import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Calendar, Check, Sigma, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* 1. StatusBadgeNode (/status — Inline Lozenge)                              */
/* -------------------------------------------------------------------------- */

export type StatusBadgeColor =
  | "neutral"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple";

const STATUS_BADGE_COLORS: Array<{
  id: StatusBadgeColor;
  labelEn: string;
  labelVi: string;
  className: string;
  swatchClass: string;
}> = [
  {
    id: "neutral",
    labelEn: "Neutral",
    labelVi: "Xám",
    className:
      "bg-surface-sunken text-foreground border-border-strong",
    swatchClass: "bg-muted-foreground/60",
  },
  {
    id: "blue",
    labelEn: "Blue",
    labelVi: "Xanh dương",
    className:
      "bg-info/15 text-info border-info/30",
    swatchClass: "bg-info",
  },
  {
    id: "green",
    labelEn: "Green",
    labelVi: "Xanh lá",
    className:
      "bg-success/15 text-success border-success/30",
    swatchClass: "bg-success",
  },
  {
    id: "amber",
    labelEn: "Amber",
    labelVi: "Vàng cam",
    className:
      "bg-warning/15 text-warning border-warning/30",
    swatchClass: "bg-warning",
  },
  {
    id: "red",
    labelEn: "Red",
    labelVi: "Đỏ",
    className:
      "bg-danger/15 text-danger border-danger/30",
    swatchClass: "bg-danger",
  },
  {
    id: "purple",
    labelEn: "Purple",
    labelVi: "Tím",
    className:
      "bg-primary-subtle text-primary border-primary/30",
    swatchClass: "bg-primary",
  },
];

function StatusBadgeView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const editable = editor.isEditable;
  const label = String(node.attrs.label || "STATUS");
  const color = (node.attrs.color || "blue") as StatusBadgeColor;
  const [open, setOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftColor, setDraftColor] = useState<StatusBadgeColor>(color);

  const colorMeta =
    STATUS_BADGE_COLORS.find((c) => c.id === color) ?? STATUS_BADGE_COLORS[1];

  const pill = (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.25 align-baseline text-[11px] font-semibold tracking-wide uppercase select-none transition-colors",
        colorMeta.className,
        editable && "cursor-pointer hover:opacity-85",
        selected && editable && "ring-ring ring-2",
      )}
    >
      {label}
    </span>
  );

  if (!editable) {
    return (
      <NodeViewWrapper as="span" className="inline">
        {pill}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setDraftLabel(label);
            setDraftColor(color);
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline border-0 bg-transparent p-0 focus-visible:outline-none"
          >
            {pill}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 space-y-3 p-3 text-xs"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="space-y-1">
            <label className="text-muted-foreground block font-medium">
              {isVi ? "Nhãn trạng thái" : "Status label"}
            </label>
            <Input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  updateAttributes({
                    label: draftLabel.trim() || "STATUS",
                    color: draftColor,
                  });
                  setOpen(false);
                }
              }}
              maxLength={32}
              placeholder="IN PROGRESS"
              className="h-7.5 text-xs uppercase"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground block font-medium">
              {isVi ? "Màu sắc" : "Color"}
            </span>
            <div className="flex items-center gap-1.5">
              {STATUS_BADGE_COLORS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setDraftColor(opt.id);
                    updateAttributes({
                      label: draftLabel.trim() || "STATUS",
                      color: opt.id,
                    });
                  }}
                  title={isVi ? opt.labelVi : opt.labelEn}
                  className={cn(
                    "size-6 cursor-pointer rounded-full border border-border transition-transform hover:scale-110 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                    opt.swatchClass,
                    draftColor === opt.id &&
                      "ring-primary ring-2 ring-offset-2 ring-offset-background",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="border-border flex items-center justify-between border-t pt-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                deleteNode();
              }}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors"
            >
              <Trash2 className="size-3" />
              {isVi ? "Xóa" : "Remove"}
            </button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => {
                updateAttributes({
                  label: draftLabel.trim() || "STATUS",
                  color: draftColor,
                });
                setOpen(false);
              }}
            >
              <Check className="size-3" />
              {isVi ? "Áp dụng" : "Apply"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

export const StatusBadgeNode = Node.create({
  name: "statusBadge",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: "STATUS",
        parseHTML: (el) =>
          el.getAttribute("data-label") || el.textContent?.trim() || "STATUS",
        renderHTML: (attrs) => ({ "data-label": attrs.label || "STATUS" }),
      },
      color: {
        default: "blue",
        parseHTML: (el) => el.getAttribute("data-color") || "blue",
        renderHTML: (attrs) => ({ "data-color": attrs.color || "blue" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="statusBadge"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "statusBadge" }),
      String(node.attrs.label || "STATUS"),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StatusBadgeView);
  },
});

/* -------------------------------------------------------------------------- */
/* 2. InlineMathNode & BlockMathNode (KaTeX)                                  */
/* -------------------------------------------------------------------------- */

const MATH_QUICK_SYMBOLS = [
  { label: "a/b", tex: "\\frac{a}{b}" },
  { label: "√x", tex: "\\sqrt{x}" },
  { label: "∑", tex: "\\sum_{i=1}^{n}" },
  { label: "∫", tex: "\\int_{a}^{b}" },
  { label: "x²", tex: "x^{2}" },
  { label: "α", tex: "\\alpha" },
  { label: "β", tex: "\\beta" },
  { label: "⇒", tex: "\\Rightarrow" },
];

function renderKatexSafe(latex: string, displayMode: boolean): string {
  const source = latex.trim();
  if (!source) return "";
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: "htmlAndMathml",
    });
  } catch {
    return source;
  }
}

function InlineMathView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const editable = editor.isEditable;
  const latex = String(node.attrs.latex || "");
  const [open, setOpen] = useState(editable && !latex);
  const [draft, setDraft] = useState(latex);

  const html = useMemo(() => renderKatexSafe(latex, false), [latex]);
  const previewHtml = useMemo(() => renderKatexSafe(draft, false), [draft]);

  const content = html ? (
    <span
      className={cn(
        "wikihub-math-inline inline-block rounded px-1 align-baseline",
        editable && "cursor-pointer hover:bg-surface-hover",
        selected && editable && "ring-ring ring-2",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span className="border-border bg-surface-sunken text-muted-foreground inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.25 text-xs">
      <Sigma className="size-3" />
      {isVi ? "Công thức" : "Math"}
    </span>
  );

  if (!editable) {
    return (
      <NodeViewWrapper as="span" className="inline">
        {content}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setDraft(latex);
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline border-0 bg-transparent p-0 focus-visible:outline-none"
          >
            {content}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2.5 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-foreground font-semibold">
              {isVi ? "Công thức toán (LaTeX)" : "Inline Math (LaTeX)"}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                deleteNode();
              }}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger rounded p-1 transition-colors"
              title={isVi ? "Xóa" : "Remove"}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                updateAttributes({ latex: draft.trim() });
                setOpen(false);
              }
            }}
            placeholder="E = mc^2"
            className="h-8 font-mono text-xs"
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            {MATH_QUICK_SYMBOLS.map((sym) => (
              <button
                key={sym.label}
                type="button"
                onClick={() => setDraft((prev) => `${prev}${sym.tex}`)}
                className="border-border bg-surface-sunken text-foreground hover:bg-surface-hover cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors"
              >
                {sym.label}
              </button>
            ))}
          </div>
          {previewHtml ? (
            <div
              className="border-border bg-surface-sunken/60 overflow-x-auto rounded border p-2 text-center"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => {
                updateAttributes({ latex: draft.trim() });
                setOpen(false);
              }}
            >
              <Check className="size-3" />
              {isVi ? "Lưu" : "Done"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

export const InlineMathNode = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-latex") || el.textContent?.trim() || "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inlineMath"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "inlineMath" }),
      String(node.attrs.latex || ""),
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$\s][^$]*?)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim();
          if (!latex) return null;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex }),
          );
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },
});

function BlockMathView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const editable = editor.isEditable;
  const latex = String(node.attrs.latex || "");
  const [editing, setEditing] = useState(editable && !latex);
  const [draft, setDraft] = useState(latex);

  const renderedHtml = useMemo(
    () => renderKatexSafe(editing ? draft : latex, true),
    [editing, draft, latex],
  );

  return (
    <NodeViewWrapper
      className={cn(
        "border-border bg-surface-sunken/40 my-3 rounded-lg border p-3 transition-colors",
        selected && editable && "ring-ring ring-2",
      )}
      contentEditable={false}
    >
      {editable && editing ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground inline-flex items-center gap-1.5 font-medium">
              <Sigma className="text-primary size-3.5" />
              {isVi ? "Khối công thức toán (KaTeX / LaTeX)" : "Math Block (KaTeX / LaTeX)"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                className="h-6.5 px-2 text-xs"
                onClick={() => {
                  updateAttributes({ latex: draft.trim() });
                  setEditing(false);
                }}
              >
                <Check className="size-3" />
                {isVi ? "Xong" : "Done"}
              </Button>
              <button
                type="button"
                onClick={deleteNode}
                className="text-muted-foreground hover:bg-danger/10 hover:text-danger cursor-pointer rounded p-1 transition-colors"
                title={isVi ? "Xóa khối" : "Remove block"}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}"
            className="border-border bg-background text-foreground focus-visible:ring-ring w-full rounded-md border p-2 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            {MATH_QUICK_SYMBOLS.map((sym) => (
              <button
                key={sym.label}
                type="button"
                onClick={() => setDraft((prev) => `${prev}${sym.tex}`)}
                className="border-border bg-surface text-foreground hover:bg-surface-hover cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors"
              >
                {sym.label}
              </button>
            ))}
          </div>
          {renderedHtml ? (
            <div
              className="border-border/70 bg-background overflow-x-auto rounded border p-3 text-center"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : null}
        </div>
      ) : (
        <div
          onClick={() => {
            if (!editable) return;
            setDraft(latex);
            setEditing(true);
          }}
          className={cn(
            "overflow-x-auto py-1 text-center",
            editable && "cursor-pointer rounded hover:bg-surface-hover/50",
          )}
        >
          {renderedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Sigma className="size-3.5" />
              {isVi
                ? "Bấm để nhập công thức LaTeX..."
                : "Click to enter LaTeX formula..."}
            </span>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const BlockMathNode = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-latex") || el.textContent?.trim() || "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="blockMath"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "blockMath" }),
      String(node.attrs.latex || ""),
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex: "" }),
          );
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView);
  },
});

/* -------------------------------------------------------------------------- */
/* 3. UserMentionNode (@username) & DateChipNode (@today)                     */
/* -------------------------------------------------------------------------- */

function UserMentionView({ node, editor, selected }: NodeViewProps) {
  const editable = editor.isEditable;
  const username = String(node.attrs.username || "");
  const label = String(node.attrs.label || username);

  const chip = (
    <span
      className={cn(
        "bg-primary-subtle text-primary inline-flex items-center rounded px-1.5 py-0.25 text-[0.92em] font-medium transition-colors",
        !editable && "hover:bg-primary/15",
        selected && editable && "ring-ring ring-2",
      )}
    >
      @{label}
    </span>
  );

  if (editable || !username) {
    return (
      <NodeViewWrapper as="span" className="inline">
        {chip}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <UserProfileTrigger
        username={username}
        fullName={label}
        openOnHover
        className="inline no-underline hover:no-underline"
      >
        {chip}
      </UserProfileTrigger>
    </NodeViewWrapper>
  );
}

export const UserMentionNode = Node.create({
  name: "userMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      username: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-username") || "",
        renderHTML: (attrs) => ({ "data-username": attrs.username || "" }),
      },
      label: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-label") ||
          el.textContent?.replace(/^@/, "").trim() ||
          el.getAttribute("data-username") ||
          "",
        renderHTML: (attrs) => ({ "data-label": attrs.label || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="userMention"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const text = `@${node.attrs.label || node.attrs.username || ""}`;
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "userMention" }),
      text,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(UserMentionView);
  },
});

function DateChipView({ node, editor, selected }: NodeViewProps) {
  const { locale } = useTranslation();
  const iso = String(node.attrs.datetime || "");
  const formatted = useMemo(() => {
    if (!iso) return "";
    const parsed = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return iso;
    return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(parsed);
  }, [iso, locale]);

  return (
    <NodeViewWrapper as="span" className="inline">
      <time
        dateTime={iso}
        className={cn(
          "border-border bg-surface-sunken text-foreground inline-flex items-center gap-1 rounded border px-1.5 py-0.25 align-baseline text-[0.88em] font-medium",
          selected && editor.isEditable && "ring-ring ring-2",
        )}
      >
        <Calendar className="text-muted-foreground size-3 shrink-0" />
        <span>{formatted || iso}</span>
      </time>
    </NodeViewWrapper>
  );
}

export const DateChipNode = Node.create({
  name: "dateChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      datetime: {
        default: "",
        parseHTML: (el) => el.getAttribute("datetime") || el.textContent?.trim() || "",
        renderHTML: (attrs) => ({ datetime: attrs.datetime || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'time[data-type="dateChip"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "time",
      mergeAttributes(HTMLAttributes, { "data-type": "dateChip" }),
      String(node.attrs.datetime || ""),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateChipView);
  },
});

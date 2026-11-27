"use client";

import type { Editor } from "@tiptap/core";
import {
  ArrowUp,
  BookMarked,
  Check,
  CornerDownLeft,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  Pencil,
  Redo2,
  Plug,
  Sparkles,
  SpellCheck,
  TriangleAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ChatFileError, uploadChatFile } from "@/lib/ai-chat";
import { aiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

// The formatted result is shown with the same renderer a saved page uses; it is
// heavy, so it only loads once there is something to show.
const ResultPreview = dynamic(
  () =>
    import("@/components/pages/rich-text-editor").then(
      (mod) => mod.RichTextContent,
    ),
  { ssr: false },
);

type Quick = "fix" | "terms" | "complete";
type Kind = Quick | "edit" | "write";

/** Where the assistant works: the words selected, or the caret in a paragraph. */
type Target = {
  from: number;
  to: number;
  /** Selected words (fix, terms, edit). */
  text: string;
  /** Paragraph text before / after the end of the target, for continuing a sentence. */
  before: string;
  after: string;
  /** Document text around the target, for writing new content that fits in. */
  docBefore: string;
  docAfter: string;
  /** Where "Insert below" goes: after this block (replacing it when it is empty). */
  blockFrom: number;
  blockTo: number;
  blockEmpty: boolean;
  left: number;
  top: number;
  /** Top edge of the caret/selection line, for aligning the minimized pill and above-line card. */
  lineTop?: number;
  /** True when the selection spans multiple cells inside a table. */
  isTableSelection?: boolean;
  /** First row of the table when excluded from a multi-cell selection. */
  tableHeaderContext?: string;
};

type AttachmentChip = {
  key: string;
  filename: string;
  status: "reading" | "ready" | "failed";
  id?: string;
  error?: string;
};

const MAX_ATTACHMENTS = 5;
const ATTACH_ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.pdf,.docx,.xlsx,.pptx,.html,.htm";

type Suggestion = {
  kind: Kind;
  /** What the author asked for ("" for the one-click actions). */
  instruction: string;
  /** Plain text (or Markdown for "write"). */
  result: string;
  /** Formatted content to insert, for "write". */
  html: string | null;
  /** The words it was asked about, to check they are unchanged on accept. */
  asked: { from: number; to: number; text: string };
};

const QUICK: Array<{
  id: Quick;
  icon: LucideIcon;
  labelKey: string;
  hintKey: string;
}> = [
  {
    id: "fix",
    icon: SpellCheck,
    labelKey: "ai.writing.fix",
    hintKey: "ai.writing.fixHint",
  },
  {
    id: "complete",
    icon: PenLine,
    labelKey: "ai.writing.complete",
    hintKey: "ai.writing.completeHint",
  },
  {
    id: "terms",
    icon: BookMarked,
    labelKey: "ai.writing.terms",
    hintKey: "ai.writing.termsHint",
  },
];

const PANEL_WIDTH = 520;
const MAX_TEXT = 4000;

/** Finds the shared ancestor depth for a table containing both $from and $to, or null. */
function sharedTableDepth(editor: Editor): number | null {
  const { $from, $to } = editor.state.selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    if ($from.node(depth).type.name === "table") {
      if ($to.pos <= $from.after(depth)) return depth;
      return null;
    }
  }
  return null;
}

/** Extracts selected cells in a ProseMirror table as Markdown rows + optional header context. */
function readTableTarget(editor: Editor): Target | null {
  const { selection, doc } = editor.state;
  const { $from, from, to } = selection;
  const isCellSel = "$anchorCell" in selection;
  const tableDepth = sharedTableDepth(editor);
  if (tableDepth === null) return null;

  const tableNode = $from.node(tableDepth);
  const tableFrom = $from.before(tableDepth);
  const tableTo = $from.after(tableDepth);
  const tableStart = tableFrom + 1;

  const selectedRows: string[] = [];
  let selectedCellCount = 0;
  let firstRowSelected = false;
  let headerLine = "";

  tableNode.forEach((rowNode, rowOffset, rowIndex) => {
    const rowStart = tableStart + rowOffset + 1;
    const rowCellTexts: string[] = [];
    const allRowCellTexts: string[] = [];

    rowNode.forEach((cellNode, cellOffset) => {
      const cellPos = rowStart + cellOffset;
      const cellEnd = cellPos + cellNode.nodeSize;
      const cellText = cellNode
        .textBetween(0, cellNode.content.size, " ", " ")
        .replace(/\s+/g, " ")
        .trim();
      allRowCellTexts.push(cellText);

      const isSelected =
        selection.ranges.length > 1
          ? selection.ranges.some(
              (r) => r.$from.pos < cellEnd && r.$to.pos > cellPos,
            )
          : from < cellEnd && to > cellPos;
      if (isSelected) {
        selectedCellCount += 1;
        rowCellTexts.push(cellText);
      }
    });

    if (rowIndex === 0) {
      const joinedHeader = `| ${allRowCellTexts.join(" | ")} |`;
      if (joinedHeader.replace(/[|\s]/g, "")) {
        headerLine = joinedHeader;
      }
      if (rowCellTexts.length > 0) firstRowSelected = true;
    }
    if (rowCellTexts.length > 0) {
      selectedRows.push(`| ${rowCellTexts.join(" | ")} |`);
    }
  });

  if (!isCellSel && selectedCellCount < 2) return null;
  const tableText = selectedRows.join("\n").slice(0, MAX_TEXT);
  if (tableText.replace(/[|\s\n]/g, "").length < 2) return null;

  try {
    let left = 0;
    let top = 0;
    const selectedDomCells =
      editor.view.dom.querySelectorAll(".selectedCell");
    if (selectedDomCells.length > 0) {
      const lastRect =
        selectedDomCells[selectedDomCells.length - 1].getBoundingClientRect();
      if (lastRect.width > 0 || lastRect.height > 0) {
        left = lastRect.right;
        top = lastRect.bottom;
      }
    }
    if (left === 0 && top === 0) {
      const coords = editor.view.coordsAtPos(Math.min(to, doc.content.size));
      left = coords.left;
      top = coords.bottom;
    }
    return {
      from,
      to,
      text: tableText,
      before: "",
      after: "",
      docBefore: doc.textBetween(0, tableFrom, "\n", " ").slice(-1500),
      docAfter: doc
        .textBetween(tableTo, doc.content.size, "\n", " ")
        .slice(0, 600),
      blockFrom: tableFrom,
      blockTo: tableTo,
      blockEmpty: false,
      left,
      top,
      isTableSelection: true,
      tableHeaderContext:
        !firstRowSelected && headerLine ? headerLine.slice(0, 1000) : undefined,
    };
  } catch {
    return null;
  }
}

/** The target for the editor's current selection, or null when there is none worth acting on. */
function readTarget(editor: Editor, caret = false): Target | null {
  const { selection, doc } = editor.state;
  const { from, to, $from, $to } = selection;
  // Multi-cell table selection: ProseMirror CellSelection or TextSelection spanning cells.
  if (!caret && ("$anchorCell" in selection || !$from.sameParent($to))) {
    const tableTarget = readTableTarget(editor);
    if (tableTarget) return tableTarget;
  }
  // One paragraph only: replacing across blocks would flatten lists and tables.
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null;
  const text = doc.textBetween(from, to, " ");
  if (!caret && (text.trim().length < 2 || text.length > MAX_TEXT)) return null;
  const block = $from.parent;
  const offsetTo = $to.parentOffset;
  const blockBefore = block.textBetween(0, offsetTo, " ").slice(-1500);
  const docBefore = doc.textBetween(0, from, "\n", " ").slice(-1500);
  const before =
    blockBefore.trim().length === 0 && docBefore.trim().length > 0
      ? docBefore.trim()
      : blockBefore;
  const after = block
    .textBetween(offsetTo, block.content.size, " ")
    .slice(0, 400);
  try {
    const coords = editor.view.coordsAtPos(to);
    return {
      from,
      to,
      text,
      before,
      after,
      docBefore,
      docAfter: doc
        .textBetween($to.after(), doc.content.size, "\n", " ")
        .slice(0, 600),
      blockFrom: $from.before(),
      blockTo: $from.after(),
      blockEmpty: block.content.size === 0,
      left: coords.left,
      top: coords.bottom,
      lineTop: coords.top,
    };
  } catch {
    return null;
  }
}

/** Below the line when there is room for a useful box there, otherwise above it. */
function placeFor(lineBottom: number): "below" | "above" {
  const height = typeof window === "undefined" ? 768 : window.innerHeight;
  const below = height - lineBottom;
  return below >= 340 || below >= lineBottom ? "below" : "above";
}

/**
 * The editor's AI helper, in the spirit of Notion's: press Ctrl+Space (or the
 * small button that appears at a selection) and describe what you want. The AI
 * writes new content at the caret or rewrites the selected words, shows it, and
 * lets you ask for changes before it is inserted. One-click actions fix grammar,
 * continue a sentence or make terminology consistent with the wiki. Nothing
 * touches the page until you insert it, and only if the words are unchanged.
 */
export function WritingAssistant({
  editor,
  spaceKey,
}: {
  editor: Editor;
  spaceKey: string;
}) {
  const { t } = useTranslation();
  const request = useRef(0);
  const promptRef = useRef<HTMLInputElement>(null);
  const refineRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  useEffect(() => {
    const onFormatMenu = (event: Event) => {
      setFormatMenuOpen(
        Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open),
      );
    };
    window.addEventListener("wikihub:selection-format-menu", onFormatMenu);
    return () =>
      window.removeEventListener("wikihub:selection-format-menu", onFormatMenu);
  }, []);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [dragging, setDragging] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineText, setRefineText] = useState("");
  // Every version the AI has given for this request, so a change that made it
  // worse can be taken back (and brought forward again).
  const [history, setHistory] = useState<{
    items: Suggestion[];
    index: number;
  }>({ items: [], index: 0 });
  const suggestion: Suggestion | null = history.items[history.index] ?? null;
  const setSuggestion = useCallback((next: Suggestion | null) => {
    setHistory((h) => {
      if (next === null) return { items: [], index: 0 };
      // A new version replaces anything that was undone past this point.
      const kept = h.items.slice(0, h.items.length ? h.index + 1 : 0);
      return { items: [...kept, next], index: kept.length };
    });
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Above or below the line it was called from; decided once, when the box opens,
  // so a result that grows the box does not make it jump to the other side.
  const [placement, setPlacement] = useState<"below" | "above">("below");

  useEffect(() => {
    let active = true;
    void aiStatus().then((status) => {
      if (!active) return;
      setEnabled(Boolean(status?.enabled));
      setCanConfigure(Boolean(status?.can_configure));
    });
    return () => {
      active = false;
    };
  }, [editor]);

  const close = useCallback(() => {
    request.current += 1;
    setOpen(false);
    setMinimized(false);
    setPrompt("");
    setAttachments([]);
    setDragging(false);
    setRefining(false);
    setRefineText("");
    setSuggestion(null);
    setError(null);
    setPending(false);
  }, [setSuggestion]);

  // The small button follows a selection while the card is closed.
  useEffect(() => {
    if (!editor || enabled !== true) return;
    const refresh = () => {
      if (open || minimized || pending || !editor.isEditable) return;
      setTarget(readTarget(editor));
    };
    editor.on("selectionUpdate", refresh);
    editor.on("blur", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("blur", refresh);
    };
  }, [editor, enabled, open, minimized, pending]);

  // The box hangs off the line it was called from: when the page scrolls, it
  // moves with that line instead of staying where it opened on screen.
  const anchored = target !== null;
  useEffect(() => {
    if (!anchored) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setTarget((current) => {
          if (!current) return current;
          try {
            const coords = editor.view.coordsAtPos(current.to);
            if (
              coords.left === current.left &&
              coords.bottom === current.top &&
              coords.top === current.lineTop
            ) {
              return current;
            }
            return {
              ...current,
              left: coords.left,
              top: coords.bottom,
              lineTop: coords.top,
            };
          } catch {
            return current;
          }
        });
      });
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [anchored, editor]);

  const attachFiles = useCallback(
    (picked: File[]) => {
      const room = MAX_ATTACHMENTS - attachments.length;
      const taken = picked.slice(0, Math.max(room, 0));
      if (!taken.length) return;
      const added: AttachmentChip[] = taken.map((file, index) => ({
        key: `${Date.now().toString(36)}-${index}-${file.name}`,
        filename: file.name,
        status: "reading",
      }));
      setAttachments((current) => [...current, ...added]);
      added.forEach((chip, index) => {
        uploadChatFile(taken[index]).then(
          (read) =>
            setAttachments((current) =>
              current.map((item) =>
                item.key === chip.key
                  ? { ...item, status: "ready", id: read.id, filename: read.filename }
                  : item,
              ),
            ),
          (caught: unknown) =>
            setAttachments((current) =>
              current.map((item) =>
                item.key === chip.key
                  ? {
                      ...item,
                      status: "failed",
                      error:
                        caught instanceof ChatFileError && caught.message && caught.message !== caught.code
                          ? caught.message
                          : t("ai.writing.attachError"),
                    }
                  : item,
              ),
            ),
        );
      });
    },
    [attachments.length, t],
  );

  const ask = useCallback(
    async (
      kind: Kind,
      on: Target,
      options: { instruction?: string; draft?: string; text?: string } = {},
    ) => {
      setError(null);
      const instruction = options.instruction ?? "";
      const text =
        options.text ??
        (kind === "complete" ? on.before : kind === "write" ? "" : on.text);
      const readyIds = attachments
        .filter((item) => item.status === "ready" && item.id)
        .map((item) => item.id!);
      if (kind !== "write" && text.trim().length < 3 && readyIds.length === 0) {
        setError(t("ai.writing.needText"));
        return;
      }
      const id = ++request.current;
      setPending(true);
      try {
        const beforeValue =
          kind === "write"
            ? [on.tableHeaderContext, on.docBefore.trim()]
                .filter(Boolean)
                .join("\n")
                .slice(-2000)
            : (on.tableHeaderContext ?? "");
        const response = await api.post<{
          result: string;
          html?: string | null;
        }>(`/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/assist`, {
          action: kind,
          text,
          instruction,
          draft: options.draft ?? "",
          before: beforeValue,
          after:
            kind === "write"
              ? on.docAfter
              : kind === "complete"
                ? on.after
                : "",
          ...(readyIds.length > 0 ? { attachment_ids: readyIds } : {}),
        });
        if (id !== request.current) return;
        setSuggestion({
          kind,
          instruction,
          result: response.result,
          html: response.html ?? null,
          asked: { from: on.from, to: on.to, text: on.text },
        });
        setRefining(false);
        setRefineText("");
      } catch (caught) {
        if (id !== request.current) return;
        setError(
          caught instanceof ApiError && caught.status !== 404 && caught.message
            ? caught.message
            : t("ai.writing.error"),
        );
      } finally {
        if (id === request.current) setPending(false);
      }
    },
    [attachments, spaceKey, t, setSuggestion],
  );

  const openPrompt = useCallback(
    (at: Target | null) => {
      if (!at) return;
      setTarget(at);
      setPlacement(placeFor(at.top));
      setMinimized(false);
      setSuggestion(null);
      setError(null);
      setOpen(true);
    },
    [setSuggestion],
  );

  useEffect(() => {
    if (open && enabled === true && !minimized && suggestion === null) {
      promptRef.current?.focus();
    }
  }, [open, enabled, minimized, suggestion]);

  useEffect(() => {
    const dom = editor?.view?.dom;
    if (!dom) return;
    if (open) {
      dom.setAttribute("data-ai-active", "true");
    } else {
      dom.removeAttribute("data-ai-active");
    }
    return () => dom.removeAttribute("data-ai-active");
  }, [editor, open]);

  // Ctrl+Space inside the editor opens the "Edit with AI" box at the caret.
  useEffect(() => {
    const dom = editor?.view?.dom;
    if (!dom) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === "Space"
      ) {
        event.preventDefault();
        openPrompt(readTarget(editor, true));
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, openPrompt]);

  // "Continue writing with AI" in the / menu (or "Ask AI" from table menu).
  useEffect(() => {
    const onRequest = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      window.setTimeout(() => {
        const at =
          mode === "prompt"
            ? (readTarget(editor) ?? readTarget(editor, true))
            : readTarget(editor, true);
        openPrompt(at);
      }, 0);
    };
    window.addEventListener("wikihub:ai-assist", onRequest);
    return () => window.removeEventListener("wikihub:ai-assist", onRequest);
  }, [editor, openPrompt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        editor.commands.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, editor]);

  // A press outside minimizes while AI is working or holding a draft; otherwise dismisses.
  useEffect(() => {
    if (!open || minimized) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (pending || suggestion !== null) {
        setMinimized(true);
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, minimized, pending, suggestion, close]);

  // The "not set up" notice is only a tooltip: carrying on typing dismisses it.
  useEffect(() => {
    if (!open || enabled === true) return;
    editor.on("update", close);
    return () => {
      editor.off("update", close);
    };
  }, [open, enabled, editor, close]);

  useEffect(() => {
    if (refining) window.setTimeout(() => refineRef.current?.focus(), 0);
  }, [refining]);

  const readingFiles = attachments.some((item) => item.status === "reading");

  function submitPrompt() {
    const instruction = prompt.trim();
    if (!target || !instruction || pending || readingFiles) return;
    void ask(target.text.trim() ? "edit" : "write", target, { instruction });
  }

  function submitRefine() {
    const instruction = refineText.trim();
    if (!target || !suggestion || !instruction || pending) return;
    if (suggestion.kind === "write") {
      void ask("write", target, { instruction, draft: suggestion.result });
    } else {
      // Revise the suggestion itself; it still replaces the same words.
      void ask("edit", target, { instruction, text: suggestion.result });
    }
  }

  /** Put the suggestion into the page, if the words it was about are unchanged. */
  function insert() {
    if (!suggestion || !target) return;
    const { asked } = suggestion;
    const { doc } = editor.state;
    const unchanged =
      asked.to <= doc.content.size &&
      (target.isTableSelection ||
        doc.textBetween(asked.from, asked.to, " ") === asked.text);
    if (!unchanged) {
      setError(t("ai.writing.stale"));
      setSuggestion(null);
      return;
    }
    const chain = editor.chain().focus();
    if (suggestion.kind === "write") {
      const content = suggestion.html ?? suggestion.result;
      if (target.blockEmpty) {
        chain
          .insertContentAt(
            { from: target.blockFrom, to: target.blockTo },
            content,
          )
          .run();
      } else {
        chain.insertContentAt(target.blockTo, content).run();
      }
    } else if (suggestion.kind === "complete") {
      const continuation = suggestion.result.trim();
      // A space between what was typed and what continues it, unless on an empty line,
      // the continuation opens with punctuation, or the text already ends in whitespace.
      const needsSpace =
        !target.blockEmpty &&
        target.before !== "" &&
        !/\s$/.test(target.before) &&
        !/^[.,;:!?)\]]/.test(continuation);
      chain
        .insertContentAt(
          asked.to,
          needsSpace ? ` ${continuation}` : continuation,
        )
        .run();
    } else if (
      target.isTableSelection &&
      !editor.state.selection.$from.sameParent(editor.state.selection.$to)
    ) {
      // Insert multi-cell table edits right below the table so cell nodes stay intact.
      const paragraphs = suggestion.result
        .split(/\n+/)
        .map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        }));
      chain
        .insertContentAt(
          target.blockTo,
          suggestion.html ??
            (paragraphs.length > 0 ? paragraphs : suggestion.result),
        )
        .run();
    } else {
      chain
        .insertContentAt({ from: asked.from, to: asked.to }, suggestion.result)
        .run();
    }
    close();
    setTarget(null);
  }

  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  // Not connected: a small notice rather than the full writing box.
  const width = Math.min(
    enabled === true ? PANEL_WIDTH : 340,
    viewportWidth - 16,
  );
  const left = target
    ? Math.max(8, Math.min(target.left + 6, viewportWidth - 36))
    : 0;
  const top = target ? Math.min(target.top + 6, viewportHeight - 36) : 0;
  const panelLeft = Math.max(
    8,
    Math.min(target?.left ?? 0, viewportWidth - width - 8),
  );
  const panelBelow = placement === "below";
  // What is left of the screen on that side, for the result area.
  const room = target
    ? panelBelow
      ? viewportHeight - top - 150
      : target.top - 150
    : 0;
  const resultMax = Math.max(140, Math.min(room, 420));
  const hasSelection = Boolean(target?.text.trim());
  const canContinue = Boolean(target && target.before.trim().length >= 3);
  const unchanged =
    suggestion !== null &&
    suggestion.kind !== "complete" &&
    suggestion.kind !== "write" &&
    suggestion.result === target?.text;
  const keepFocusUnlessInput = (event: React.MouseEvent) => {
    // Pressing buttons must not clear the editor selection; typing boxes need focus.
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  };

  if (!target || typeof document === "undefined") return null;
  // Hide the floating AI trigger button while the right-click text formatting
  // menu is open so it does not paint on top of the formatting controls.
  if (!open && formatMenuOpen) return null;
  // A selection with the assistant off shows nothing; only the shortcut explains.
  if (enabled !== true && !open) return null;

  const insertLabel =
    suggestion?.kind === "write" || target.isTableSelection
      ? t("ai.writing.insertBelow")
      : suggestion?.kind === "complete"
        ? t("ai.writing.insert")
        : t("ai.writing.replace");
  const pillLeft = Math.max(8, Math.min(target.left, viewportWidth - 220));
  const pillTop = Math.max(
    8,
    Math.min((target.lineTop ?? target.top - 24) - 2, viewportHeight - 36),
  );

  return createPortal(
    !open ? (
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => openPrompt(target)}
        aria-label={t("ai.writing.button")}
        title={t("ai.writing.button")}
        style={{ left, top }}
        className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring fixed z-50 flex size-7 cursor-pointer items-center justify-center rounded-full shadow-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Sparkles className="size-3.5" aria-hidden />
      </button>
    ) : minimized ? (
      <div
        ref={panelRef}
        data-testid="writing-assistant-minimized"
        onMouseDown={(event) => event.preventDefault()}
        style={{ left: pillLeft, top: pillTop }}
        className="border-border bg-surface-raised text-foreground fixed z-50 flex items-center gap-1.5 rounded-lg border py-1 pr-1.5 pl-2.5 shadow-lg"
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="text-foreground hover:text-primary focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          {pending ? (
            <>
              <Loader2 className="text-primary size-3.5 animate-spin" aria-hidden />
              <span>{t("ai.writing.generating")}</span>
            </>
          ) : (
            <>
              <Sparkles className="text-primary size-3.5" aria-hidden />
              <span>{t("ai.writing.draftReady")}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={t("ai.selectionAi.close")}
          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
    ) : (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("ai.writing.button")}
        onMouseDown={keepFocusUnlessInput}
        onDragEnter={(event) => {
          if (enabled !== true || suggestion !== null || pending) return;
          const dt = event.dataTransfer;
          if (!dt) return;
          const hasFile =
            Array.from(dt.types ?? []).includes("Files") ||
            Array.from(dt.items ?? []).some((item) => item.kind === "file");
          if (!hasFile) return;
          event.preventDefault();
          event.stopPropagation();
          dt.dropEffect = "copy";
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (enabled !== true || suggestion !== null || pending) return;
          const dt = event.dataTransfer;
          if (!dt) return;
          const hasFile =
            Array.from(dt.types ?? []).includes("Files") ||
            Array.from(dt.items ?? []).some((item) => item.kind === "file");
          if (!hasFile) return;
          event.preventDefault();
          event.stopPropagation();
          dt.dropEffect = "copy";
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          setDragging(false);
          if (enabled !== true || suggestion !== null || pending) return;
          const dt = event.dataTransfer;
          if (!dt) return;
          const fromFiles = Array.from(dt.files ?? []);
          const files =
            fromFiles.length > 0
              ? fromFiles
              : Array.from(dt.items ?? [])
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
          if (!files.length) return;
          event.preventDefault();
          event.stopPropagation();
          attachFiles(files);
          promptRef.current?.focus();
        }}
        style={{
          left: panelLeft,
          width,
          ...(panelBelow
            ? { top }
            : {
                bottom:
                  viewportHeight - (target.lineTop ?? target.top - 24) + 6,
              }),
        }}
        className={cn(
          "border-border bg-surface-raised text-foreground fixed z-50 max-w-[calc(100vw-1rem)] rounded-lg border shadow-lg transition-shadow duration-150",
          dragging && "border-primary ring-primary/25 ring-2",
        )}
      >
        {enabled !== true ? (
          <div className="flex items-start gap-2.5 p-3">
            <span className="bg-warning-bg text-warning flex size-7 shrink-0 items-center justify-center rounded-full">
              <Plug className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("ai.notEnabledTitle")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {canConfigure
                  ? t("ai.setup.adminLead")
                  : t("ai.setup.userLead")}
              </p>
              {canConfigure ? (
                <Button asChild variant="primary" size="sm" className="mt-2">
                  <Link href="/admin/ai">{t("ai.openSettings")}</Link>
                </Button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t("ai.selectionAi.close")}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : suggestion === null ? (
          <>
            {attachments.length > 0 ? (
              <div className="border-border flex flex-wrap gap-1.5 border-b px-3 py-2">
                {attachments.map((chip) => (
                  <span
                    key={chip.key}
                    title={chip.error ?? chip.filename}
                    className={cn(
                      "inline-flex max-w-44 items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                      chip.status === "failed"
                        ? "border-danger/40 bg-danger-bg text-danger"
                        : "border-border bg-surface-sunken text-foreground",
                    )}
                  >
                    {chip.status === "reading" ? (
                      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <FileText className="size-3 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{chip.filename}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((item) => item.key !== chip.key),
                        )
                      }
                      aria-label={t("ai.selectionAi.close")}
                      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring -mr-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <X className="size-2.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <form
              className="flex items-center gap-1.5 px-2.5 py-2"
              onSubmit={(event) => {
                event.preventDefault();
                // This card renders inside the page's edit form (React events cross
                // portals), so the submit must not reach it and save the page.
                event.stopPropagation();
                submitPrompt();
              }}
            >
              <span className="text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <input
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData?.files ?? []);
                  if (!files.length) return;
                  event.preventDefault();
                  attachFiles(files);
                }}
                disabled={pending}
                maxLength={1000}
                aria-label={t("ai.writing.promptLabel")}
                placeholder={
                  hasSelection
                    ? t("ai.writing.promptEdit")
                    : t("ai.writing.promptWrite")
                }
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                data-testid="writing-assistant-file-input"
                tabIndex={-1}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.currentTarget.value = "";
                  attachFiles(files);
                }}
              />
              <button
                type="button"
                disabled={pending || attachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
                aria-label={t("ai.writing.attachFile")}
                title={t("ai.writing.attachFile")}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              >
                <Paperclip className="size-4" aria-hidden />
              </button>
              <button
                type="submit"
                disabled={pending || readingFiles || !prompt.trim()}
                aria-label={t("ai.writing.send")}
                title={t("ai.writing.send")}
                className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <ArrowUp className="size-4" aria-hidden />
                )}
              </button>
            </form>

            {pending ? (
              <p className="text-muted-foreground border-border flex items-center gap-2 border-t px-3 py-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("ai.writing.working")}
              </p>
            ) : (
              <div className="border-border grid gap-0.5 border-t p-1">
                {QUICK.map(({ id, icon: Icon, labelKey, hintKey }) => {
                  const usable = id === "complete" ? canContinue : hasSelection;
                  if (!usable) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void ask(id, target)}
                      className="group text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Icon
                        className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors duration-150"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {t(labelKey)}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {t(hintKey)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {error ? (
              <p
                role="alert"
                className="text-danger bg-danger-bg border-danger/40 m-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
              <p className="text-muted-foreground line-clamp-1 min-w-0 flex-1 text-xs">
                {suggestion.instruction || t(`ai.writing.${suggestion.kind}`)}
              </p>
              {history.items.length > 1 ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("ai.writing.undo")}
                    title={t("ai.writing.undo")}
                    disabled={pending || history.index === 0}
                    onClick={() =>
                      setHistory((h) => ({
                        ...h,
                        index: Math.max(0, h.index - 1),
                      }))
                    }
                  >
                    <Undo2 aria-hidden />
                  </Button>
                  <span
                    className="text-muted-foreground min-w-8 text-center text-xs tabular-nums"
                    aria-live="polite"
                  >
                    {history.index + 1}/{history.items.length}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("ai.writing.redo")}
                    title={t("ai.writing.redo")}
                    disabled={
                      pending || history.index >= history.items.length - 1
                    }
                    onClick={() =>
                      setHistory((h) => ({
                        ...h,
                        index: Math.min(h.items.length - 1, h.index + 1),
                      }))
                    }
                  >
                    <Redo2 aria-hidden />
                  </Button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={close}
                aria-label={t("ai.selectionAi.close")}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>

            <div
              style={{ maxHeight: resultMax }}
              aria-live="polite"
              aria-busy={pending}
              className={cn(
                "wh-scroll overflow-y-auto px-4 py-2 transition-opacity duration-150",
                pending && "opacity-40",
              )}
            >
              {unchanged ? (
                <p className="text-muted-foreground text-sm">
                  {t("ai.writing.unchanged")}
                </p>
              ) : suggestion.html ? (
                <ResultPreview content={suggestion.html} />
              ) : (
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {suggestion.result}
                </p>
              )}
            </div>

            {error ? (
              <p
                role="alert"
                className="text-danger bg-danger-bg border-danger/40 mx-3 mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                {error}
              </p>
            ) : null}

            <div className="border-border border-t p-2.5">
              {refining ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    submitRefine();
                  }}
                >
                  <input
                    ref={refineRef}
                    value={refineText}
                    onChange={(event) => setRefineText(event.target.value)}
                    disabled={pending}
                    maxLength={1000}
                    aria-label={t("ai.writing.refineLabel")}
                    placeholder={t("ai.writing.refinePlaceholder")}
                    className="placeholder:text-muted-foreground border-border hover:border-border-strong bg-surface focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2"
                  />
                  <button
                    type="submit"
                    disabled={pending || !refineText.trim()}
                    aria-label={t("ai.writing.send")}
                    title={t("ai.writing.send")}
                    className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                  >
                    {pending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <ArrowUp className="size-4" aria-hidden />
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRefining(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </form>
              ) : (
                <div className="flex items-center justify-start gap-2">
                  {unchanged ? null : (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={pending}
                      onClick={insert}
                    >
                      {suggestion.kind === "write" ? (
                        <CornerDownLeft aria-hidden />
                      ) : (
                        <Check aria-hidden />
                      )}
                      {insertLabel}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => setRefining(true)}
                  >
                    <Pencil aria-hidden />
                    {t("ai.writing.edit")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      close();
                      editor.commands.focus();
                    }}
                  >
                    <X aria-hidden />
                    {t("ai.writing.discard")}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    ),
    document.body,
  );
}

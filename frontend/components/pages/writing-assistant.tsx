"use client";

import type { Editor } from "@tiptap/core";
import {
  ArrowUp,
  BookMarked,
  Check,
  CornerDownLeft,
  Loader2,
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
};

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

/** The target for the editor's current selection, or null when there is none worth acting on. */
function readTarget(editor: Editor, caret = false): Target | null {
  const { selection, doc } = editor.state;
  const { from, to, $from, $to } = selection;
  // One paragraph only: replacing across blocks would flatten lists and tables.
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null;
  const text = doc.textBetween(from, to, " ");
  if (!caret && (text.trim().length < 2 || text.length > MAX_TEXT)) return null;
  const block = $from.parent;
  const offsetTo = $to.parentOffset;
  const before = block.textBetween(0, offsetTo, " ").slice(-1500);
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
      docBefore: doc.textBetween(0, from, "\n", " ").slice(-1500),
      docAfter: doc
        .textBetween($to.after(), doc.content.size, "\n", " ")
        .slice(0, 600),
      blockFrom: $from.before(),
      blockTo: $from.after(),
      blockEmpty: block.content.size === 0,
      left: coords.left,
      top: coords.bottom,
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
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
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
    setPrompt("");
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
      if (open || !editor.isEditable) return;
      setTarget(readTarget(editor));
    };
    editor.on("selectionUpdate", refresh);
    editor.on("blur", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("blur", refresh);
    };
  }, [editor, enabled, open]);

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
            if (coords.left === current.left && coords.bottom === current.top) {
              return current;
            }
            return { ...current, left: coords.left, top: coords.bottom };
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
      if (kind !== "write" && text.trim().length < 3) {
        setError(t("ai.writing.needText"));
        return;
      }
      const id = ++request.current;
      setPending(true);
      try {
        const response = await api.post<{
          result: string;
          html?: string | null;
        }>(`/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/assist`, {
          action: kind,
          text,
          instruction,
          draft: options.draft ?? "",
          before: kind === "write" ? on.docBefore.trim() : "",
          after:
            kind === "write"
              ? on.docAfter
              : kind === "complete"
                ? on.after
                : "",
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
    [spaceKey, t, setSuggestion],
  );

  const openPrompt = useCallback(
    (at: Target | null) => {
      if (!at) return;
      setTarget(at);
      setPlacement(placeFor(at.top));
      setSuggestion(null);
      setError(null);
      setOpen(true);
      window.setTimeout(() => promptRef.current?.focus(), 0);
    },
    [setSuggestion],
  );

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

  // "Continue writing with AI" in the / menu: finish the sentence at the caret.
  useEffect(() => {
    const onRequest = () => {
      window.setTimeout(() => {
        const at = readTarget(editor, true);
        if (!at) return;
        setTarget(at);
        setPlacement(placeFor(at.top));
        setSuggestion(null);
        setOpen(true);
        if (enabled) void ask("complete", at);
      }, 0);
    };
    window.addEventListener("wikihub:ai-assist", onRequest);
    return () => window.removeEventListener("wikihub:ai-assist", onRequest);
  }, [editor, enabled, ask, setSuggestion]);

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

  // A press anywhere outside the box dismisses it, like any other popover.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

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

  function submitPrompt() {
    const instruction = prompt.trim();
    if (!target || !instruction || pending) return;
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
      doc.textBetween(asked.from, asked.to, " ") === asked.text;
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
      // A space between what was typed and what continues it, unless the
      // continuation opens with punctuation or the text already ends in one.
      const needsSpace =
        target.before !== "" &&
        !/\s$/.test(target.before) &&
        !/^[.,;:!?)\]]/.test(continuation);
      chain
        .insertContentAt(
          asked.to,
          needsSpace ? ` ${continuation}` : continuation,
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
  // A selection with the assistant off shows nothing; only the shortcut explains.
  if (enabled !== true && !open) return null;

  const insertLabel =
    suggestion?.kind === "write"
      ? t("ai.writing.insertBelow")
      : suggestion?.kind === "complete"
        ? t("ai.writing.insert")
        : t("ai.writing.replace");

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
    ) : (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("ai.writing.button")}
        onMouseDown={keepFocusUnlessInput}
        style={{
          left: panelLeft,
          width,
          ...(panelBelow
            ? { top }
            : { bottom: viewportHeight - target.top + 30 }),
        }}
        className="border-border bg-surface fixed z-50 max-w-[calc(100vw-1rem)] rounded-xl border shadow-lg"
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
            <form
              className="flex items-center gap-2 p-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                // This card renders inside the page's edit form (React events cross
                // portals), so the submit must not reach it and save the page.
                event.stopPropagation();
                submitPrompt();
              }}
            >
              <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <input
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={pending}
                maxLength={1000}
                aria-label={t("ai.writing.promptLabel")}
                placeholder={
                  hasSelection
                    ? t("ai.writing.promptEdit")
                    : t("ai.writing.promptWrite")
                }
                className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="submit"
                disabled={pending || !prompt.trim()}
                aria-label={t("ai.writing.send")}
                title={t("ai.writing.send")}
                className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
              <div className="border-border grid gap-0.5 border-t p-1.5">
                {QUICK.map(({ id, icon: Icon, labelKey, hintKey }) => {
                  const usable = id === "complete" ? canContinue : hasSelection;
                  if (!usable) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void ask(id, target)}
                      className="hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Icon
                        className="text-primary size-4 shrink-0"
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
                    className="placeholder:text-muted-foreground border-border bg-surface focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2"
                  />
                  <button
                    type="submit"
                    disabled={pending || !refineText.trim()}
                    aria-label={t("ai.writing.send")}
                    title={t("ai.writing.send")}
                    className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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

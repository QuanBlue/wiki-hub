"use client";

import { type EditorState, type Transaction } from "@tiptap/pm/state";
import { type NodeType } from "@tiptap/pm/model";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { NodeViewProps } from "@tiptap/core";
import {
  Check,
  ChevronDown,
  Ellipsis,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CODE_THEMES, DEFAULT_CODE_THEME, normaliseCodeTheme } from "@/lib/code-themes";
import { useTranslation } from "@/lib/i18n/context";
import { CODE_LANGUAGES, highlightToLines, type CodeToken } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";

import { ignoreNodeViewChrome } from "./content-normalize";

/** Language picker order: `CODE_LANGUAGES` insertion order, computed once. */
const CODE_LANGUAGE_ENTRIES = Object.entries(CODE_LANGUAGES);

/** Tiny "Aa" chip painted with a theme's own surface and text colours. */
function CodeThemeSwatch({ theme }: { theme: string }) {
  return (
    <span
      aria-hidden
      data-code-theme={normaliseCodeTheme(theme) ?? undefined}
      className="wikihub-code border-code-border bg-code-bg inline-flex size-6 shrink-0 items-center justify-center rounded border font-mono text-[10px] leading-none font-semibold"
    >
      A<span className="text-code-highlight">a</span>
    </span>
  );
}

/**
 * Static rendition of a code block for the details modal - the same
 * header/gutter/colours as the real `.wikihub-code` block, but built from
 * plain `CodeToken`s instead of a ProseMirror node view, so it can show the
 * caption and language a person is still drafting before they hit Save.
 */
function CodeBlockPreview({
  caption,
  languageLabel,
  theme,
  lines,
  tokenLines,
}: {
  caption: string;
  languageLabel: string;
  theme: string | null;
  lines: number[];
  tokenLines: CodeToken[][];
}) {
  return (
    <div
      data-code-theme={theme ?? undefined}
      className="wikihub-code border-code-border bg-code-bg flex h-full flex-col overflow-hidden rounded-md border"
    >
      <div className="border-code-border bg-code-inset flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        {caption ? (
          <span className="text-code-muted min-w-0 flex-1 truncate font-mono text-xs">
            {caption}
          </span>
        ) : (
          <span aria-hidden className="flex-1" />
        )}
        <span className="text-code-muted shrink-0 font-mono text-xs">
          {languageLabel}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="border-code-border bg-code-inset text-code-muted sticky left-0 border-r px-3 py-4 text-right font-mono text-xs !leading-6 select-none">
          {lines.map((line) => (
            <div key={line} className="h-6">
              {line}
            </div>
          ))}
        </div>
        <pre className="!my-0 flex-1 !border-0 !bg-transparent !p-4 font-mono text-xs !leading-6">
          <code className="!m-0 !block bg-transparent !p-0 !font-mono !text-xs !leading-6 whitespace-pre">
            {tokenLines.map((tokens, lineIdx) => (
              <div key={lineIdx} className="h-6">
                {tokens.map((token, tokenIdx) => (
                  <span key={tokenIdx} className={token.className ?? undefined}>
                    {token.text}
                  </span>
                ))}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * Filterable language list for the code block details modal. Rendered inline
 * rather than in a portaled menu so the filter input keeps focus while the
 * arrow keys move through the list - a Radix menu would take focus (and its
 * own typeahead) away from the input. Arrow keys move the selection itself, so
 * the modal's live preview follows along.
 */
function LanguagePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filterLanguages = (text: string) => {
    const needle = text.trim().toLowerCase();
    if (!needle) return CODE_LANGUAGE_ENTRIES;
    return CODE_LANGUAGE_ENTRIES.filter(
      ([key, label]) =>
        label.toLowerCase().includes(needle) ||
        key.toLowerCase().includes(needle),
    );
  };
  const matches = useMemo(() => filterLanguages(query), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [value, matches, open]);

  function updateQuery(next: string) {
    setQuery(next);
    const next_matches = filterLanguages(next);
    // Keep the current choice if it still matches; otherwise jump to the top
    // result so Save picks what the filter is showing.
    if (next_matches.length > 0 && !next_matches.some(([key]) => key === value))
      onChange(next_matches[0][0]);
  }

  function closeList() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      closeList();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (matches.length === 0) return;
    const current = matches.findIndex(([key]) => key === value);
    const step = event.key === "ArrowDown" ? 1 : -1;
    onChange(matches[(current + step + matches.length) % matches.length][0]);
  }

  const selected = matches.find(([key]) => key === value)?.[0];
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={t("editor.codeLanguageAria")}
        aria-haspopup="listbox"
        aria-expanded={open}
        // While open the list closes on blur; keeping focus in the filter on
        // mousedown lets this click toggle it shut instead of reopening it.
        onMouseDown={(event) => {
          if (open) event.preventDefault();
        }}
        onClick={() => (open ? closeList() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          inputClassName,
          "flex cursor-pointer items-center justify-between gap-2 text-left",
        )}
      >
        <span className="truncate">{CODE_LANGUAGES[value] ?? value}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-border bg-surface absolute top-full right-0 left-0 z-20 mt-1 space-y-1 rounded-lg border p-1 shadow-lg">
          <Input
            role="combobox"
            aria-label={t("editor.searchLanguage")}
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={
              selected ? `${id}-opt-${selected}` : undefined
            }
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("editor.searchLanguage")}
            autoComplete="off"
            autoFocus
          />
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            className="max-h-56 overflow-y-auto overscroll-contain"
          >
            {matches.length === 0 ? (
              <div className="text-muted-foreground px-2.5 py-2 text-sm">
                {t("editor.noLanguageMatch")}
              </div>
            ) : (
              matches.map(([key, label]) => (
                <div
                  key={key}
                  id={`${id}-opt-${key}`}
                  role="option"
                  aria-selected={key === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(key);
                    closeList();
                  }}
                  className={cn(
                    "hover:bg-surface-hover relative flex cursor-pointer items-center rounded-md py-2 pr-8 pl-2.5 text-sm transition-colors duration-150",
                    key === value && "bg-surface-selected",
                  )}
                >
                  {label}
                  {key === value ? (
                    <Check
                      aria-hidden
                      className="text-primary absolute right-2.5 size-4"
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CodeBlockWithLines({
  editor,
  node,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const text = (node.textContent || "").replace(/\n$/, "");
  const lineCount = text.split("\n").length;
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);
  const language: string = node.attrs.language || "";
  const canEdit = editor.isEditable;

  const caption = String(node.attrs.caption ?? "");
  // Title and language are edited together in a modal rather than inline in
  // the header bar - a bare text input sitting right above a code block was
  // too easy to mistake for the first line of the snippet and type into by
  // accident. The modal is a Radix dialog portaled to document.body, well
  // outside ProseMirror's contentEditable DOM, so unlike an inline input
  // nothing typed there can be reinterpreted as a document command.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const [languageDraft, setLanguageDraft] = useState(language || "plaintext");
  const theme = normaliseCodeTheme(node.attrs.codeTheme);
  const [themeDraft, setThemeDraft] = useState(theme ?? DEFAULT_CODE_THEME);
  const { t } = useTranslation();

  function openDetails() {
    setCaptionDraft(caption);
    setLanguageDraft(language || "plaintext");
    setThemeDraft(theme ?? DEFAULT_CODE_THEME);
    setDetailsOpen(true);
  }

  function saveDetails() {
    const trimmed = captionDraft.trim();
    updateAttributes({
      caption: trimmed || null,
      language: languageDraft,
      codeTheme: normaliseCodeTheme(themeDraft),
    });
    setDetailsOpen(false);
  }

  const languageLabel = language ? (CODE_LANGUAGES[language] ?? language) : "";
  const showHeader = canEdit || Boolean(caption) || Boolean(language);

  // Live preview inside the details modal: the block's own text, tokenised
  // for whatever language is currently drafted (not yet saved), so choosing
  // a language shows its actual colours before committing to it.
  const previewTokenLines = useMemo(
    () => highlightToLines(text, detailsOpen ? languageDraft : language),
    [text, languageDraft, detailsOpen, language],
  );

  return (
    <NodeViewWrapper
      data-code-theme={theme ?? undefined}
      className="wikihub-code group border-code-border bg-code-bg relative my-4 flex flex-col overflow-hidden rounded-md border"
    >
      {showHeader ? (
        <div
          contentEditable={false}
          className="border-code-border bg-code-inset flex h-9 items-center justify-between gap-2 border-b px-3"
        >
          {caption ? (
            <span className="text-code-muted min-w-0 flex-1 truncate font-mono text-xs">
              {caption}
            </span>
          ) : (
            <span aria-hidden className="flex-1" />
          )}

          <div className="flex shrink-0 items-center gap-1">
            {languageLabel ? (
              <span className="text-code-muted font-mono text-xs">
                {languageLabel}
              </span>
            ) : null}
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("editor.codeBlockOptionsAria")}
                    title="Code block options"
                    className="text-code-muted hover:bg-code-border hover:text-code-fg focus-visible:ring-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Ellipsis className="size-3.5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={openDetails} className="gap-2">
                    <Pencil className="size-4" aria-hidden />
                    {t("editor.editTitleLanguage")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={deleteNode}
                    destructive
                    className="gap-2"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("editor.deleteCodeBlock")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}
      {canEdit ? (
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent
            title={t("editor.codeBlockDetails")}
            description={t("editor.codeBlockDetailsDescription")}
            className="max-w-5xl"
          >
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="space-y-5 sm:w-56 sm:shrink-0">
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium"
                    htmlFor="code-caption"
                  >
                    {t("editor.title")}
                  </label>
                  <Input
                    id="code-caption"
                    value={captionDraft}
                    onChange={(event) => setCaptionDraft(event.target.value)}
                    placeholder={t("editor.captionPlaceholder")}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium"
                    htmlFor="code-language"
                  >
                    {t("editor.language")}
                  </label>
                  <LanguagePicker
                    id="code-language"
                    value={languageDraft}
                    onChange={setLanguageDraft}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium"
                    htmlFor="code-theme"
                  >
                    {t("editor.codeTheme")}
                  </label>
                  <Select value={themeDraft} onValueChange={setThemeDraft}>
                    <SelectTrigger
                      id="code-theme"
                      aria-label={t("editor.codeTheme")}
                    >
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          <CodeThemeSwatch theme={themeDraft} />
                          {CODE_THEMES.find((x) => x.key === themeDraft)
                            ?.label ?? themeDraft}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {CODE_THEMES.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          <span className="flex min-w-0 items-center gap-2">
                            <CodeThemeSwatch theme={option.key} />
                            <span className="truncate">{option.label}</span>
                            <span className="text-muted-foreground ml-auto shrink-0 pr-1 text-xs">
                              {option.mode === "dark"
                                ? t("editor.themeDark")
                                : t("editor.themeLight")}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="block text-sm font-medium">Preview</span>
                <div className="h-[28rem]">
                  <CodeBlockPreview
                    caption={captionDraft.trim()}
                    languageLabel={
                      CODE_LANGUAGES[languageDraft] ?? languageDraft
                    }
                    theme={normaliseCodeTheme(themeDraft)}
                    lines={lines}
                    tokenLines={previewTokenLines}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDetailsOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={saveDetails}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <div className="flex">
        <div className="border-code-border bg-code-inset text-code-muted border-r px-3 py-4 text-right font-mono text-xs !leading-6 select-none">
          {lines.map((line) => (
            <div key={line} className="h-6">
              {line}
            </div>
          ))}
        </div>
        <pre className="!my-0 flex-1 overflow-x-auto !border-0 !bg-transparent !p-4 font-mono text-xs !leading-6">
          <NodeViewContent
            className={cn(
              "!m-0 !block bg-transparent !p-0 !font-mono !text-xs !leading-6 whitespace-pre",
              language ? `language-${language}` : "",
            )}
          />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
const CODE_INDENT = "  ";

function shiftCodeBlockIndent(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  codeBlockType: NodeType,
  direction: "indent" | "outdent",
): boolean {
  const { $from, $to, empty } = state.selection;
  if ($from.parent.type !== codeBlockType || $to.parent !== $from.parent)
    return false;
  if (!dispatch) return true;

  const blockStart = $from.start();
  const text = $from.parent.textContent;
  const fromOffset = $from.parentOffset;
  const toOffset = $to.parentOffset;

  // A bare caret with Tab inserts the indent where it stands, so Tab can
  // still be used to space out a line; every other case works on whole lines.
  if (empty && direction === "indent") {
    dispatch(state.tr.insertText(CODE_INDENT, $from.pos).scrollIntoView());
    return true;
  }

  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    // A selection ending at the very start of a line does not include it.
    const touched =
      lineEnd >= fromOffset &&
      offset <= toOffset &&
      !(offset === toOffset && toOffset > fromOffset);
    if (touched) lineStarts.push(offset);
    offset = lineEnd + 1;
  }

  const tr = state.tr;
  // Last line first, so earlier positions stay valid as text is edited.
  for (const start of [...lineStarts].reverse()) {
    const pos = blockStart + start;
    if (direction === "indent") {
      tr.insertText(CODE_INDENT, pos);
      continue;
    }
    const leading = text.slice(start).match(/^( {1,2}|\t)/);
    if (leading) tr.delete(pos, pos + leading[0].length);
  }
  if (!tr.docChanged) return true;
  dispatch(tr.scrollIntoView());
  return true;
}
export const CustomCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    const parentAttributes = (this.parent?.() ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    return {
      ...parentAttributes,
      // A block with no language chosen must stay genuinely unset - no
      // `language-plaintext` class - so an untouched or freshly typed
      // snippet round-trips exactly as it always has. `defaultLanguage:
      // "plaintext"` (configured below) is read only by the highlighting
      // plugin, as the fallback that keeps that same falsy language
      // monochrome instead of guessing it from the text.
      language: {
        ...parentAttributes.language,
        default: null,
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-caption"),
        renderHTML: (attributes: { caption?: string | null }) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      // Colour theme, as a key from lib/code-themes. Null (the default
      // Monokai Pro look) writes nothing, so untouched blocks serialise as
      // they always have.
      codeTheme: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normaliseCodeTheme(element.getAttribute("data-code-theme")),
        renderHTML: (attributes: { codeTheme?: string | null }) => {
          const theme = normaliseCodeTheme(attributes.codeTheme);
          return theme ? { "data-code-theme": theme } : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockWithLines, { ignoreMutation: ignoreNodeViewChrome });
  },
  addKeyboardShortcuts() {
    return {
      // Selecting the whole document from inside a long snippet is rarely
      // what someone wants - scope Ctrl/Cmd-A to just this block's code
      // first. Falls through to the editor's normal select-all (returns
      // false) whenever the cursor isn't inside a code block at all.
      "Mod-a": () => {
        const { $from } = this.editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type === this.type) {
            return this.editor.commands.setTextSelection({
              from: $from.start(depth),
              to: $from.end(depth),
            });
          }
        }
        return false;
      },
      // Tab / Shift-Tab indent and outdent the selected lines (or just the
      // caret's line) by two spaces, like a code editor, instead of moving
      // keyboard focus out of the block. Outside a code block they return
      // false so lists and table cells keep their own Tab behaviour.
      Tab: () =>
        this.editor.commands.command(({ state, dispatch }) =>
          shiftCodeBlockIndent(state, dispatch, this.type, "indent"),
        ),
      "Shift-Tab": () =>
        this.editor.commands.command(({ state, dispatch }) =>
          shiftCodeBlockIndent(state, dispatch, this.type, "outdent"),
        ),
    };
  },
});

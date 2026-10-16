"use client";

import {
  BookOpen,
  Check,
  Globe,
  Languages,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Action = "explain" | "translate";
type Language = "en" | "vi";

const LANGUAGES: Array<{ value: Language; labelKey: string }> = [
  { value: "en", labelKey: "language.english" },
  { value: "vi", labelKey: "language.vietnamese" },
];

type Selection = {
  text: string;
  context: string;
  right: number;
  bottom: number;
};

const MAX_SELECTION = 2000;
const PANEL_WIDTH = 360;
const BLOCKS = "p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption";

/** The words the reader selected inside `root`, and where their selection ends. */
function readSelection(
  root: HTMLElement,
): { selection: Selection; range: Range } | null {
  const current = window.getSelection();
  if (!current || current.rangeCount === 0 || current.isCollapsed) return null;
  const range = current.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = current.toString().trim();
  if (!text || text.length > MAX_SELECTION) return null;
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  if (!last || (last.width === 0 && last.height === 0)) return null;
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const context = (element?.closest(BLOCKS)?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    selection: {
      text,
      context: context.slice(0, 800),
      right: last.right,
      bottom: last.bottom,
    },
    range: range.cloneRange(),
  };
}

/**
 * Select words in a page and a small AI button appears at the end of the
 * selection; it opens a card that explains the selection or translates it.
 * Nothing is sent until the reader picks Explain or Translate, and the server
 * remembers each answer, so asking again is free.
 */
export function SelectionAssistant({
  spaceKey,
  pageSlug,
  children,
}: {
  spaceKey: string;
  pageSlug: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Opening the language menu moves focus, which some browsers answer by
  // clearing the selection; the card must outlive that.
  const menuOpenRef = useRef(false);
  const answers = useRef(new Map<string, string>());
  const request = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // What the answer is written in, or what Translate turns the words into.
  // Opening the card explains the words in Vietnamese straight away.
  const [language, setLanguage] = useState<Language>("vi");

  useEffect(() => {
    let active = true;
    void aiStatus().then((status) => {
      if (active) setEnabled(Boolean(status?.enabled));
    });
    return () => {
      active = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setAction(null);
    setResult(null);
    setError(null);
    setPending(false);
    request.current += 1;
  }, []);

  // Follow the reader's selection; while the card is open it stays on the words
  // it was opened for until the selection is cleared.
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const refresh = () => {
      const root = rootRef.current;
      if (!root) return;
      const found = readSelection(root);
      if (!found) {
        if (
          open &&
          (menuOpenRef.current ||
            panelRef.current?.contains(document.activeElement ?? null))
        ) {
          return;
        }
        rangeRef.current = null;
        setSelection(null);
        close();
        return;
      }
      if (open) return;
      rangeRef.current = found.range;
      setSelection(found.selection);
    };
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 120);
    };
    document.addEventListener("selectionchange", onChange);
    onChange(); // pick up a selection made before the assistant was ready
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [enabled, open, close]);

  // Keep the button on the words while the page scrolls or resizes.
  useEffect(() => {
    if (!selection) return;
    const reposition = () => {
      const range = rangeRef.current;
      if (!range) return;
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      if (last) {
        setSelection((value) =>
          value ? { ...value, right: last.right, bottom: last.bottom } : value,
        );
      }
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [selection !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function run(next: Action, lang: Language = language) {
    if (!selection) return;
    setAction(next);
    setError(null);
    const key = `${next}|${lang}|${selection.text}`;
    const known = answers.current.get(key);
    if (known !== undefined) {
      setResult(known);
      setPending(false);
      return;
    }
    const id = ++request.current;
    setResult(null);
    setPending(true);
    try {
      const response = await api.post<{ result: string }>(
        `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/explain`,
        {
          text: selection.text,
          context: selection.context,
          action: next,
          lang,
        },
      );
      if (id !== request.current) return;
      answers.current.set(key, response.result);
      setResult(response.result);
    } catch (caught) {
      if (id !== request.current) return;
      setError(
        caught instanceof ApiError && caught.status !== 404 && caught.message
          ? caught.message
          : t("ai.selectionAi.error"),
      );
    } finally {
      if (id === request.current) setPending(false);
    }
  }

  // A press on the button or card must not clear the selection it belongs to.
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  const buttonLeft = selection
    ? Math.min(selection.right + 4, viewportWidth - 36)
    : 0;
  const buttonTop = selection
    ? Math.min(selection.bottom + 4, viewportHeight - 36)
    : 0;
  const panelLeft = Math.max(
    8,
    Math.min(buttonLeft, viewportWidth - PANEL_WIDTH - 8),
  );
  const panelBelow = buttonTop + 44 + 220 < viewportHeight;

  const floating =
    enabled && selection
      ? createPortal(
          <>
            {!open ? (
              <button
                type="button"
                onMouseDown={keepSelection}
                onClick={() => {
                  setOpen(true);
                  void run("explain");
                }}
                aria-label={t("ai.selectionAi.button")}
                title={t("ai.selectionAi.button")}
                style={{ left: buttonLeft, top: buttonTop }}
                className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring fixed z-50 flex size-7 cursor-pointer items-center justify-center rounded-full shadow-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <Sparkles className="size-3.5" aria-hidden />
              </button>
            ) : (
              <div
                ref={panelRef}
                role="dialog"
                aria-label={t("ai.selectionAi.button")}
                onMouseDown={keepSelection}
                style={{
                  left: panelLeft,
                  width: PANEL_WIDTH,
                  ...(panelBelow
                    ? { top: buttonTop }
                    : { bottom: viewportHeight - selection.bottom + 28 }),
                }}
                className="border-border bg-surface fixed z-50 max-w-[calc(100vw-1rem)] rounded-lg border p-3 shadow-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-muted-foreground line-clamp-2 min-w-0 text-xs break-words">
                    “{selection.text}”
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    aria-label={t("ai.selectionAi.close")}
                    className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring -mt-0.5 -mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  {(["explain", "translate"] as const).map((value) => {
                    const Icon = value === "explain" ? BookOpen : Languages;
                    const selected = action === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={selected ? "primary" : "secondary"}
                        aria-pressed={selected}
                        disabled={pending && !selected}
                        onClick={() => void run(value)}
                      >
                        <Icon aria-hidden />
                        {t(`ai.selectionAi.${value}`)}
                      </Button>
                    );
                  })}
                  <DropdownMenu
                    modal={false}
                    onOpenChange={(value) => {
                      menuOpenRef.current = value;
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t("ai.selectionAi.language")}
                        title={t("ai.selectionAi.language")}
                        className="ml-auto h-8 gap-1.5 px-2 text-xs font-semibold"
                      >
                        <Globe className="size-3.5 shrink-0" aria-hidden />
                        <span aria-hidden>{language.toUpperCase()}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[60] w-44">
                      <DropdownMenuLabel>
                        {t("ai.selectionAi.language")}
                      </DropdownMenuLabel>
                      {LANGUAGES.map((option) => {
                        const active = option.value === language;
                        return (
                          <DropdownMenuItem
                            key={option.value}
                            disabled={pending}
                            onSelect={() => {
                              setLanguage(option.value);
                              if (action) void run(action, option.value);
                            }}
                            className={cn(
                              active && "bg-primary-subtle text-foreground",
                            )}
                          >
                            <span className="flex-1">{t(option.labelKey)}</span>
                            {active ? (
                              <Check
                                aria-hidden
                                className="text-primary ml-auto size-4"
                              />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div
                  aria-live="polite"
                  aria-busy={pending}
                  className={cn(
                    "wh-scroll mt-2 max-h-64 overflow-y-auto rounded-md px-3 py-2",
                    // A failure gets a red ground so it cannot be read as an answer.
                    !pending && error
                      ? "border-danger/40 bg-danger-bg border"
                      : "bg-surface-sunken",
                  )}
                >
                  {pending ? (
                    <p className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2
                        className="size-3.5 animate-spin"
                        aria-hidden
                      />
                      {t("ai.selectionAi.thinking")}
                    </p>
                  ) : error ? (
                    <p
                      role="alert"
                      className="text-danger flex items-start gap-2 text-sm"
                    >
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden
                      />
                      {error}
                    </p>
                  ) : (
                    <IssueMarkdown
                      source={result ?? ""}
                      autolink
                      className="text-xs leading-5"
                    />
                  )}
                </div>
              </div>
            )}
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={rootRef}>{children}</div>
      {floating}
    </>
  );
}

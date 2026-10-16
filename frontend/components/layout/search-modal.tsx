"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileText, Grid2X2, Loader2, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "@/components/layout/navigation-progress";
import {
  SearchAnswer,
  type AnswerState,
} from "@/components/layout/search-answer";
import { Badge } from "@/components/ui/badge";
import { useThemeSettings } from "@/components/theme-color-provider";
import { AnswerTimeoutError, askWiki, sourceHref, type AnswerSource } from "@/lib/ai-answer";
import { aiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { highlightRanges } from "@/lib/search-highlight";
import { isLocalFindActive } from "@/lib/local-find-registry";
import { cn } from "@/lib/utils";
import type {
  SearchResultPage,
  SearchResultSpace,
  SearchResults,
} from "@/types/api";

type SearchItem =
  | { kind: "space"; data: SearchResultSpace }
  | { kind: "page"; data: SearchResultPage };

function HighlightText({
  text,
  query,
  terms,
}: {
  text: string;
  query: string;
  /** What the server searched for, folded; without it the typed query is marked as is. */
  terms?: string[];
}) {
  if (!query.trim() || !text) return <>{text}</>;

  const mark = (part: string, index: number) => (
    <mark
      key={index}
      className="bg-primary/25 text-primary py-0.2 rounded-xs px-0.5 font-bold"
    >
      {part}
    </mark>
  );

  if (terms?.length) {
    const ranges = highlightRanges(text, terms);
    if (ranges.length === 0) return <>{text}</>;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    ranges.forEach(([start, end], index) => {
      if (start > cursor) parts.push(text.slice(cursor, start));
      parts.push(mark(text.slice(start, end), index));
      cursor = end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts}</>;
  }

  const trimmed = query.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === trimmed.toLowerCase() ? mark(part, index) : part,
      )}
    </>
  );
}

export function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const themeSettings = useThemeSettings();
  const { t } = useTranslation();
  const siteName = themeSettings?.siteName || "WikiHub";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  // Which search is the latest: answers can arrive out of order, because a question that
  // waits on the semantic model takes longer than the next one.
  const latestSearch = useRef(0);
  // The AI answer to the question asked from here, when there is one (or one is on its way).
  const [aiOn, setAiOn] = useState(false);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const latestAnswer = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Global quick-search shortcut, whatever the user has bound it to.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Quick search shares Ctrl+F with "find within this content" in a few
      // local previews (a text attachment's raw contents, say). While one of
      // those owns the chord, defer instead of popping this over it.
      if (matchesShortcut("attachment.find", event) && isLocalFindActive())
        return;
      if (!matchesShortcut("search.open", event)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Focus input on modal open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // Whether the AI assistant is on decides if a question can be asked from here.
      void aiStatus().then((status) => setAiOn(status.enabled === true));
    } else {
      setQuery("");
      setResults(null);
      setSelectedIndex(0);
      latestAnswer.current += 1;
      setAnswer(null);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  // Debounced search query
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      const mine = ++latestSearch.current;
      setLoading(true);
      try {
        const data = await api.get<SearchResults>(
          `/api/v1/search?q=${encodeURIComponent(query.trim())}`,
        );
        // A slower answer to an earlier question must not replace the answer to this one.
        if (mine !== latestSearch.current) return;
        setResults(data);
        setSelectedIndex(0);
      } catch {
        if (mine !== latestSearch.current) return;
        setResults({ query: query.trim(), spaces: [], pages: [] });
      } finally {
        if (mine === latestSearch.current) setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      // Typing on (or clearing the box) makes any search still in flight out of date.
      latestSearch.current += 1;
    };
  }, [query]);

  // Flatten items for unified keyboard navigation
  const flatItems = useMemo<SearchItem[]>(() => {
    if (!results) return [];
    const items: SearchItem[] = [];
    for (const space of results.spaces) {
      items.push({ kind: "space", data: space });
    }
    for (const page of results.pages) {
      items.push({ kind: "page", data: page });
    }
    return items;
  }, [results]);

  const selectItem = useCallback(
    (item: SearchItem) => {
      onOpenChange(false);
      if (item.kind === "space") {
        navigate(`/spaces/${encodeURIComponent(item.data.key)}`);
      } else {
        navigate(
          `/spaces/${encodeURIComponent(item.data.space_key)}/pages/${encodeURIComponent(item.data.slug)}`,
        );
      }
    },
    [onOpenChange, navigate],
  );

  const leaveAnswer = useCallback(() => {
    latestAnswer.current += 1; // whatever is still on its way is out of date
    setAnswer(null);
  }, []);

  const ask = useCallback(async () => {
    const question = query.trim();
    if (!aiOn || question.length < 2) return;
    const mine = ++latestAnswer.current;
    setAnswer({ status: "loading" });
    try {
      const result = await askWiki(question);
      if (mine !== latestAnswer.current) return;
      setAnswer({ status: "done", result });
    } catch (error) {
      if (mine !== latestAnswer.current) return;
      const key =
        error instanceof AnswerTimeoutError
          ? "search.answerTimeout"
          : error instanceof ApiError && error.status === 429
            ? "search.answerRateLimited"
            : error instanceof ApiError && error.status === 503
              ? "search.answerUnavailable"
              : "search.answerError";
      setAnswer({ status: "error", message: t(key) });
    }
  }, [aiOn, query, t]);

  const openSource = useCallback(
    (source: AnswerSource) => {
      onOpenChange(false);
      navigate(sourceHref(source));
    },
    [onOpenChange, navigate],
  );

  // Keyboard navigation inside search results
  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ctrl+Enter asks the AI; plain Enter still opens the highlighted result.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void ask();
      return;
    }
    // While an answer is shown, the keys belong to it (Enter presses the focused source).
    if (answer) return;
    if (!flatItems.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % flatItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + flatItems.length) % flatItems.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (flatItems[selectedIndex]) {
        selectItem(flatItems[selectedIndex]);
      }
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-xs" />
        <DialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-[18%] left-[50%] z-50 flex max-h-[70vh] w-full -translate-x-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl duration-150 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            // An answer can hold a table: give it room, the plain results keep the narrow box.
            answer ? "max-w-3xl" : "max-w-xl",
          )}
          onKeyDown={handleKeyDown}
          // Escape first leaves the answer for the results, then closes the search.
          onEscapeKeyDown={(event) => {
            if (answer) {
              event.preventDefault();
              leaveAnswer();
            }
          }}
        >
          {/* Header Search Input */}
          <div className="border-border flex items-center border-b px-4 py-3">
            <Search className="text-muted-foreground mr-3 size-5 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // An answer belongs to the question it was asked for.
                if (answer) leaveAnswer();
              }}
              placeholder={t("search.inputPlaceholder", { siteName })}
              className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-base outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  leaveAnswer();
                }}
                className="text-muted-foreground hover:text-foreground mr-2 cursor-pointer rounded p-1"
                aria-label={t("search.clearQuery")}
              >
                <X className="size-4" />
              </button>
            ) : null}
            <kbd className="border-border text-muted-foreground bg-surface-sunken hidden rounded border px-1.5 py-0.5 font-mono text-xs sm:inline">
              ESC
            </kbd>
          </div>

          {/* Results List or Empty States */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {answer ? (
              <SearchAnswer
                question={query.trim()}
                state={answer}
                onBack={leaveAnswer}
                onRetry={() => void ask()}
                onOpen={openSource}
              />
            ) : (
              <>
                {aiOn && query.trim().length >= 2 ? (
                  <button
                    type="button"
                    onClick={() => void ask()}
                    className="border-border hover:bg-surface-hover focus-visible:ring-ring mb-2 flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Sparkles
                      className="text-primary size-4 shrink-0"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t("search.askAi", { query: query.trim() })}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t("search.askAiHint")}
                      </span>
                    </span>
                    <kbd className="border-border text-muted-foreground bg-surface-sunken hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                      Ctrl ↵
                    </kbd>
                  </button>
                ) : null}
                {loading ? (
                  <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
                    <Loader2 className="text-primary mr-2 size-5 animate-spin" />
                    {t("search.searching", { siteName })}
                  </div>
                ) : !query.trim() ? (
                  <div className="text-muted-foreground py-12 text-center text-sm">
                    <p className="text-foreground font-medium">
                      {t("search.quickSearchTitle", { siteName })}
                    </p>
                    <p className="mt-1 text-xs">
                      {t("search.quickSearchHint")}
                    </p>
                  </div>
                ) : results && flatItems.length === 0 ? (
                  <div className="text-muted-foreground py-12 text-center text-sm">
                    {t("search.noResults", { query })}
                  </div>
                ) : (
                  <div className="space-y-4 py-1">
                    {/* Spaces Section */}
                    {results?.spaces && results.spaces.length > 0 ? (
                      <div>
                        <div className="text-muted-foreground px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                          Spaces ({results.spaces.length})
                        </div>
                        <ul className="space-y-1">
                          {results.spaces.map((space) => {
                            const itemIndex = flatItems.findIndex(
                              (i) =>
                                i.kind === "space" && i.data.id === space.id,
                            );
                            const isSelected = itemIndex === selectedIndex;
                            return (
                              <li key={space.id}>
                                <button
                                  ref={(el) => {
                                    itemRefs.current[itemIndex] = el;
                                  }}
                                  type="button"
                                  onClick={() =>
                                    selectItem({ kind: "space", data: space })
                                  }
                                  onMouseEnter={() =>
                                    setSelectedIndex(itemIndex)
                                  }
                                  className={cn(
                                    "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                                    isSelected
                                      ? "bg-surface-selected text-primary"
                                      : "hover:bg-surface-hover text-foreground",
                                  )}
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <Grid2X2 className="text-muted-foreground size-4 shrink-0" />
                                    <span className="truncate text-sm font-medium">
                                      <HighlightText
                                        text={space.name}
                                        query={query}
                                        terms={results?.terms}
                                      />
                                    </span>
                                    {space.description ? (
                                      <span className="text-muted-foreground max-w-xs truncate text-xs">
                                        —{" "}
                                        <HighlightText
                                          text={space.description}
                                          query={query}
                                          terms={results?.terms}
                                        />
                                      </span>
                                    ) : null}
                                  </div>
                                  <Badge
                                    variant="subtle"
                                    className="shrink-0 font-mono text-[11px]"
                                  >
                                    {space.key}
                                  </Badge>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}

                    {/* Pages Section */}
                    {results?.pages && results.pages.length > 0 ? (
                      <div>
                        <div className="text-muted-foreground px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                          Pages ({results.pages.length})
                        </div>
                        <ul className="space-y-1">
                          {results.pages.map((page) => {
                            const itemIndex = flatItems.findIndex(
                              (i) => i.kind === "page" && i.data.id === page.id,
                            );
                            const isSelected = itemIndex === selectedIndex;
                            return (
                              <li key={page.id}>
                                <button
                                  ref={(el) => {
                                    itemRefs.current[itemIndex] = el;
                                  }}
                                  type="button"
                                  onClick={() =>
                                    selectItem({ kind: "page", data: page })
                                  }
                                  onMouseEnter={() =>
                                    setSelectedIndex(itemIndex)
                                  }
                                  className={cn(
                                    "flex w-full cursor-pointer items-start justify-between rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                                    isSelected
                                      ? "bg-surface-selected text-primary"
                                      : "hover:bg-surface-hover text-foreground",
                                  )}
                                >
                                  <div className="flex min-w-0 flex-1 items-start gap-3 pr-3">
                                    <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium">
                                        <HighlightText
                                          text={page.title}
                                          query={query}
                                          terms={results?.terms}
                                        />
                                      </div>
                                      {page.snippet ? (
                                        <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
                                          <HighlightText
                                            text={page.snippet}
                                            query={query}
                                            terms={results?.terms}
                                          />
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    <Badge
                                      variant="subtle"
                                      className="font-mono text-[11px]"
                                    >
                                      {page.space_key}
                                    </Badge>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer keyboard hint */}
          <div className="border-border bg-surface-sunken text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-[11px]">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="border-border bg-surface rounded border px-1 font-mono">
                  ↑
                </kbd>{" "}
                <kbd className="border-border bg-surface rounded border px-1 font-mono">
                  ↓
                </kbd>{" "}
                {t("search.hintNavigate")}
              </span>
              <span>
                <kbd className="border-border bg-surface rounded border px-1 font-mono">
                  ↵
                </kbd>{" "}
                {t("search.hintSelect")}
              </span>
              {aiOn ? (
                <span>
                  <kbd className="border-border bg-surface rounded border px-1 font-mono">
                    Ctrl
                  </kbd>{" "}
                  <kbd className="border-border bg-surface rounded border px-1 font-mono">
                    ↵
                  </kbd>{" "}
                  {t("search.hintAsk")}
                </span>
              ) : null}
            </div>
            <span>
              <kbd className="border-border bg-surface rounded border px-1 font-mono">
                ESC
              </kbd>{" "}
              {t("search.hintClose")}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

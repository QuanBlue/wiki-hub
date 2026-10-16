"use client";

import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  ExternalLink,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  SendHorizontal,
  Sparkles,
  SquarePen,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useChat } from "@/components/chat/use-chat";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { SelectionAssistant } from "@/components/pages/selection-assistant";
import {
  AlsoRead,
  SectionLabel,
  SourceRow,
} from "@/components/layout/answer-sources";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { aiStatus } from "@/lib/ai-summary";
import {
  citeLinks,
  sourceHref,
  type AnswerSource,
  type WebSource,
} from "@/lib/ai-answer";
import {
  CHAT_MAX_CHARS,
  CHAT_OPEN_EVENT,
  CHAT_TOGGLE_EVENT,
  type ChatEntry,
  type ChatSlots,
  type ChatFailure,
  type ChatOpenDetail,
} from "@/lib/ai-chat";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Assistant = Extract<ChatEntry, { role: "assistant" }>;

const DEFAULT_WIDTH = 416;
const MIN_WIDTH = 320;
const WIDTH_KEY = "wikihub:chat-width";
/** Within this of the page's width counts as "the whole width". */
const FULL_SLACK = 24;

function readWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH
      ? stored
      : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** How long a reply runs before the panel says it is still working, and then that it is slow. */
const SLOW_AFTER_MS = 6000;
const VERY_SLOW_AFTER_MS = 20000;

const FAILURE_KEY: Record<ChatFailure, string> = {
  timeout: "search.answerTimeout",
  unavailable: "search.answerUnavailable",
  rate_limited: "search.answerRateLimited",
  error: "search.answerError",
};

const NOT_FOUND_KEY: Record<string, string> = {
  no_match: "search.answerNoMatch",
  not_in_pages: "search.answerNotInPages",
  ungrounded: "search.answerUngrounded",
  web_failed: "search.answerWebFailed",
};

/** Waiting for the first words: say it is working, then that it is slow. */
function Waiting({ searching }: { searching?: string }) {
  const { t } = useTranslation();
  const [slowness, setSlowness] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const first = setTimeout(() => setSlowness(1), SLOW_AFTER_MS);
    const second = setTimeout(() => setSlowness(2), VERY_SLOW_AFTER_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, []);
  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-sm">
      <span className="flex items-center">
        <Loader2
          className="text-primary mr-2 size-4 animate-spin"
          aria-hidden
        />
        {searching
          ? t("chat.searching", { query: searching })
          : t("search.answerLoading")}
      </span>
      {slowness === 1 ? (
        <span className="text-xs">{t("search.answerSlow")}</span>
      ) : null}
      {slowness === 2 ? (
        <span className="text-xs">{t("search.answerVerySlow")}</span>
      ) : null}
    </div>
  );
}

/** An internet page an answer was read from: opens in a new tab, never inside WikiHub. */
function WebSourceRow({ page }: { page: WebSource }) {
  return (
    <li>
      <a
        href={page.url}
        target="_blank"
        rel="noopener noreferrer"
        title={page.snippet || page.title}
        className="hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="bg-surface-sunken text-muted-foreground inline-flex min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] leading-5 font-semibold">
          w{page.n}
        </span>
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px]">
          {page.title}
        </span>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-[10px]">
          {page.host}
          <ExternalLink className="size-3" aria-hidden />
        </span>
      </a>
    </li>
  );
}

function AssistantMessage({
  entry,
  onOpen,
  onRetry,
  canRetry,
}: {
  entry: Assistant;
  onOpen: (source: AnswerSource) => void;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const { t } = useTranslation();

  if (entry.status === "streaming" && !entry.content) {
    return <Waiting searching={entry.searching} />;
  }

  if (entry.status === "streaming") {
    return (
      <IssueMarkdown
        source={entry.content}
        autolink
        codeCard
        className="text-foreground text-[15px] leading-7"
      />
    );
  }

  if (entry.status === "error") {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-danger flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(FAILURE_KEY[entry.failure ?? "error"])}
        </p>
        {canRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t("search.answerRetry")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!entry.found) {
    const related = entry.related ?? [];
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm" role="status">
          {t(NOT_FOUND_KEY[entry.reason ?? ""] ?? "search.answerNotInPages")}
        </p>
        {related.length ? (
          <section aria-label={t("search.answerMayHelp")}>
            <SectionLabel>{t("search.answerMayHelp")}</SectionLabel>
            <ul className="space-y-0.5">
              {related.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onOpen={onOpen}
                  numbered={false}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const sources = entry.sources ?? [];
  const related = entry.related ?? [];
  const webSources = entry.webSources ?? [];
  const byNumber = new Map(sources.map((source) => [source.n, source]));
  const webByNumber = new Map(webSources.map((source) => [source.n, source]));
  return (
    <div className="space-y-2">
      <IssueMarkdown
        source={citeLinks(entry.content)}
        autolink
        onCite={(n, web) => {
          if (web) {
            const page = webByNumber.get(n);
            if (page) window.open(page.url, "_blank", "noopener,noreferrer");
            return;
          }
          const source = byNumber.get(n);
          if (source) onOpen(source);
        }}
        codeCard
        className="text-foreground text-[15px] leading-7"
      />
      {entry.basis === "general" ? (
        <p
          role="note"
          className="text-muted-foreground bg-surface-sunken flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("chat.generalNote")}
        </p>
      ) : null}
      {webSources.length ? (
        <section aria-label={t("chat.webSources")}>
          <SectionLabel>{t("chat.webSources")}</SectionLabel>
          <ul className="space-y-0.5">
            {webSources.map((page) => (
              <WebSourceRow key={page.n} page={page} />
            ))}
          </ul>
        </section>
      ) : null}
      {sources.length ? (
        <section aria-label={t("search.answerSources")}>
          <SectionLabel>{t("search.answerSources")}</SectionLabel>
          <ul className="space-y-0.5">
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                onOpen={onOpen}
                numbered
              />
            ))}
          </ul>
          {related.length ? <AlsoRead pages={related} onOpen={onOpen} /> : null}
        </section>
      ) : null}
    </div>
  );
}

/** A small icon button under a question: quiet until the question is hovered or focused. */
function QuestionAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** What the person asked: copy it, or change it and ask again from there. */
function UserMessage({
  entry,
  busy,
  onEdit,
  versions,
  onSwitch,
}: {
  entry: Extract<ChatEntry, { role: "user" }>;
  busy: boolean;
  onEdit: (id: string, text: string) => void;
  /** Where this question stands among its edited versions, when it has been edited. */
  versions?: { index: number; total: number };
  onSwitch: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const box = boxRef.current;
    if (!editing || !box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 192)}px`;
  }, [editing, draft]);

  useEffect(() => {
    if (!editing) return;
    const box = boxRef.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, [editing]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.content);
    } catch {
      return; // not allowed here (plain http, no permission): nothing to confirm
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setEditing(false);
    // Unchanged is not a new question; just close the box.
    if (text !== entry.content) onEdit(entry.id, text);
  };

  if (editing) {
    return (
      <div className="border-border bg-surface ml-auto w-full max-w-[90%] space-y-2 rounded-3xl border p-3 shadow-sm">
        <textarea
          ref={boxRef}
          value={draft}
          maxLength={CHAT_MAX_CHARS}
          rows={1}
          aria-label={t("chat.edit")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              setDraft(entry.content);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          className="placeholder:text-muted-foreground max-h-48 w-full resize-none bg-transparent px-1 text-[15px] leading-6 outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(false);
              setDraft(entry.content);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!draft.trim() || busy}
            onClick={send}
          >
            {t("chat.editSend")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex flex-col items-end gap-1"
      // What the panel keeps in place when another version is shown (see ChatPanel).
      data-slot={entry.slot}
    >
      <p className="bg-primary-subtle text-foreground max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] leading-6 wrap-break-word whitespace-pre-wrap">
        {entry.content}
      </p>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        {versions ? (
          <>
            <QuestionAction
              label={t("chat.previousVersion")}
              disabled={busy || versions.index <= 1}
              onClick={() => onSwitch(-1)}
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </QuestionAction>
            <span
              className="text-muted-foreground px-0.5 text-xs tabular-nums"
              aria-live="polite"
            >
              {t("chat.versionOf", {
                index: versions.index,
                total: versions.total,
              })}
            </span>
            <QuestionAction
              label={t("chat.nextVersion")}
              disabled={busy || versions.index >= versions.total}
              onClick={() => onSwitch(1)}
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </QuestionAction>
          </>
        ) : null}
        <QuestionAction
          label={copied ? t("chat.copied") : t("chat.copy")}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </QuestionAction>
        <QuestionAction
          label={t("chat.edit")}
          disabled={busy}
          onClick={() => {
            setDraft(entry.content);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" aria-hidden />
        </QuestionAction>
      </div>
    </div>
  );
}

function Message({
  entry,
  onOpen,
  onRetry,
  canRetry,
  busy,
  onEdit,
  versions,
  onSwitch,
}: {
  entry: ChatEntry;
  onOpen: (source: AnswerSource) => void;
  onRetry: () => void;
  canRetry: boolean;
  busy: boolean;
  onEdit: (id: string, text: string) => void;
  versions?: { index: number; total: number };
  onSwitch: (delta: -1 | 1) => void;
}) {
  if (entry.role === "user") {
    return (
      <UserMessage
        entry={entry}
        busy={busy}
        onEdit={onEdit}
        versions={versions}
        onSwitch={onSwitch}
      />
    );
  }
  return (
    <div className="px-1">
      <AssistantMessage
        entry={entry}
        onOpen={onOpen}
        onRetry={onRetry}
        canRetry={canRetry}
      />
    </div>
  );
}

/** Which version of an edited question this is, among how many; nothing for one never edited. */
function versionsOf(entry: ChatEntry, slots: ChatSlots) {
  if (entry.role !== "user" || !entry.slot) return undefined;
  const slot = slots[entry.slot];
  return slot && slot.variants.length > 1
    ? { index: slot.active + 1, total: slot.variants.length }
    : undefined;
}

function ChatPanel({
  userId,
  onClose,
  expanded,
  onToggleExpanded,
  adoptRef,
}: {
  userId: string;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  adoptRef: React.MutableRefObject<((detail: ChatOpenDetail) => void) | null>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    entries,
    slots,
    loaded,
    busy,
    send,
    edit,
    switchVersion,
    stop,
    retry,
    clear,
    adopt,
  } = useChat(userId);
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  // Where the question being switched sat in the list, so it can be kept there.
  const anchorRef = useRef<{ slot: string; top: number } | null>(null);
  const [away, setAway] = useState(false);

  useEffect(() => {
    adoptRef.current = (detail) => {
      if (detail.question && detail.result)
        adopt(detail.question, detail.result);
    };
    return () => {
      adoptRef.current = null;
    };
  }, [adopt, adoptRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Another version of a question has another length of answer under it. Without this the list
  // would jump and the question would no longer be where it was clicked; keep it in place.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const list = listRef.current;
    if (!anchor || !list) return;
    anchorRef.current = null;
    const el = list.querySelector<HTMLElement>(
      `[data-slot="${CSS.escape(anchor.slot)}"]`,
    );
    if (!el) return;
    const top =
      el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += top - anchor.top;
  }, [entries]);

  // Follow the reply as it is written - unless the person has scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [entries]);

  // The box grows with what is typed, up to a few lines.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 128)}px`;
  }, [draft]);

  const open = useCallback(
    (source: AnswerSource) => {
      router.push(sourceHref(source));
      // On a small screen the panel covers the page it just opened.
      if (window.matchMedia("(max-width: 767px)").matches) onClose();
    },
    [router, onClose],
  );

  const submit = useCallback(
    (text: string) => {
      if (!text.trim() || busy) return;
      stickRef.current = true;
      setDraft("");
      void send(text);
    },
    [busy, send],
  );

  const onStop = () => {
    const asked = stop();
    if (asked) setDraft(asked);
    inputRef.current?.focus();
  };

  const examples = [t("chat.example1"), t("chat.example2"), t("chat.example3")];
  const last = entries[entries.length - 1];

  return (
    <>
      <header className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="text-primary size-4" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t("chat.title")}
        </h2>
        <Button
          variant="subtle"
          size="sm"
          disabled={entries.length === 0}
          onClick={() => setConfirmClear(true)}
        >
          <SquarePen aria-hidden />
          {t("chat.newChat")}
        </Button>
        <Button
          variant="subtle"
          size="icon"
          onClick={onToggleExpanded}
          aria-label={expanded ? t("chat.collapse") : t("chat.expand")}
          title={expanded ? t("chat.collapse") : t("chat.expand")}
          aria-pressed={expanded}
          className="hidden sm:inline-flex"
        >
          {expanded ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </Button>
        <Button
          variant="subtle"
          size="icon"
          onClick={onClose}
          aria-label={t("chat.close")}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label={t("chat.title")}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setAway(!stickRef.current);
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-5",
          "sm:px-[max(1rem,calc((100%-48rem)/2))]",
        )}
      >
        {loaded && entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <span className="bg-primary-subtle text-primary flex size-10 items-center justify-center rounded-full">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-semibold">{t("chat.emptyTitle")}</p>
            <p className="text-muted-foreground text-xs">
              {t("chat.emptyHint")}
            </p>
            <div className="flex w-full flex-col gap-1.5">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => submit(example)}
                  className="border-border text-foreground hover:bg-surface-hover hover:border-border-strong focus-visible:ring-ring cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SelectionAssistant
            endpoint="/api/v1/ai/explain"
            className="space-y-6"
          >
            {entries.map((entry) => (
              <Message
                key={entry.id}
                entry={entry}
                onOpen={open}
                onRetry={retry}
                canRetry={entry === last && !busy}
                busy={busy}
                onEdit={edit}
                versions={versionsOf(entry, slots)}
                onSwitch={(delta) => {
                  if (entry.role !== "user" || !entry.slot) return;
                  const list = listRef.current;
                  const el = list?.querySelector<HTMLElement>(
                    `[data-slot="${CSS.escape(entry.slot)}"]`,
                  );
                  if (list && el) {
                    anchorRef.current = {
                      slot: entry.slot,
                      top:
                        el.getBoundingClientRect().top -
                        list.getBoundingClientRect().top,
                    };
                    // Not following the end of the conversation while looking at another version.
                    stickRef.current = false;
                    setAway(true);
                  }
                  switchVersion(entry.slot, delta);
                }}
              />
            ))}
          </SelectionAssistant>
        )}
      </div>

      <div
        className={cn(
          "relative shrink-0 px-4 pt-1 pb-3",
          "sm:px-[max(1rem,calc((100%-48rem)/2))]",
        )}
      >
        {away ? (
          <button
            type="button"
            onClick={() => {
              const list = listRef.current;
              stickRef.current = true;
              setAway(false);
              list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
            }}
            aria-label={t("chat.scrollDown")}
            title={t("chat.scrollDown")}
            className="border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-ring absolute -top-11 left-1/2 flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border shadow-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
          className="border-border bg-surface focus-within:border-border-strong flex items-end gap-2 rounded-3xl border py-1.5 pr-1.5 pl-3 shadow-sm transition-shadow duration-150 focus-within:shadow-md"
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={CHAT_MAX_CHARS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line. Never while an input method (such as
              // Telex) is still composing a word - that Enter belongs to the word.
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit(draft);
              }
            }}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            className="placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-5 outline-none"
          />
          {busy ? (
            <Button
              type="button"
              variant="primary"
              size="icon"
              onClick={onStop}
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              className="size-9 rounded-full"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              disabled={!draft.trim()}
              aria-label={t("chat.send")}
              title={t("chat.send")}
              className="size-9 rounded-full"
            >
              <SendHorizontal className="size-4" aria-hidden />
            </Button>
          )}
        </form>
        <p className="text-muted-foreground/70 mt-1.5 px-1 text-[10px]">
          {t("search.answerCheck")}
        </p>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("chat.newConfirmTitle")}
        description={t("chat.newConfirmBody")}
        confirmLabel={t("chat.newConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          clear();
          setDraft("");
          setConfirmClear(false);
          inputRef.current?.focus();
        }}
      />
    </>
  );
}

/**
 * The chat with the wiki: a button at the corner of every page that opens a panel at the
 * right, so a question can be asked - and followed up - without leaving what is being read.
 * It does not exist at all while the AI assistant is off.
 */
export function ChatWidget({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  // Mounted on first use, then kept (hidden) so a reply being written is not lost on close.
  const [everOpened, setEverOpened] = useState(false);
  // Widened to the whole width of the page, for long answers and tables.
  const [expanded, setExpanded] = useState(false);
  // How wide the panel is when it is not the whole page: dragged by its left edge.
  // Read once: nothing is drawn from it until the panel is opened, long after hydration.
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const next = window.innerWidth - event.clientX;
      if (next >= window.innerWidth - FULL_SLACK) {
        setExpanded(true);
        return;
      }
      setExpanded(false);
      setWidth(Math.max(MIN_WIDTH, Math.round(next)));
    };
    const stop = () => setDragging(false);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  // Remember the width that was chosen.
  useEffect(() => {
    if (dragging) return;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // not kept
    }
  }, [dragging, width]);
  const adoptRef = useRef<((detail: ChatOpenDetail) => void) | null>(null);
  const pending = useRef<ChatOpenDetail | null>(null);

  useEffect(() => {
    let alive = true;
    void aiStatus().then((status) => {
      if (alive) setEnabled(status.enabled === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<ChatOpenDetail>).detail ?? {};
      pending.current = detail;
      setEverOpened(true);
      setOpen(true);
      // The panel may not be mounted yet: hand over once it is.
      setTimeout(() => {
        if (pending.current && adoptRef.current) {
          adoptRef.current(pending.current);
          pending.current = null;
        }
      }, 0);
    };
    const onToggle = () => {
      setEverOpened(true);
      setOpen((value) => !value);
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    window.addEventListener(CHAT_TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
      window.removeEventListener(CHAT_TOGGLE_EVENT, onToggle);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape first puts away the card that explains words; the panel stays.
      if (document.querySelector("[data-selection-assistant][role=dialog]"))
        return;
      const panel = document.getElementById("wikihub-chat-panel");
      // Only while the focus is in the panel, so Escape elsewhere keeps its own meaning.
      if (panel?.contains(document.activeElement)) setOpen(false);
    };
    // A click anywhere outside the panel puts it away - except in the dialogs and menus the
    // panel itself opens, which live outside it in the page.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.isConnected) return;
      const panel = document.getElementById("wikihub-chat-panel");
      if (!panel || panel.contains(target)) return;
      // The top bar button toggles the panel itself.
      if (target.closest("[data-chat-toggle], [data-selection-assistant]")) {
        return;
      }
      if (
        target.closest(
          '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!enabled) return null;

  return (
    <>
      {everOpened ? (
        <aside
          id="wikihub-chat-panel"
          aria-label={t("chat.title")}
          hidden={!open}
          style={{ "--chat-width": `${width}px` } as React.CSSProperties}
          className={cn(
            "border-border bg-background fixed top-(--wh-topbar-height) right-0 bottom-0 z-40 flex w-full max-w-full flex-col border-l shadow-xl",
            !dragging &&
              "transition-[width] duration-200 motion-reduce:transition-none",
            expanded ? "sm:w-full" : "sm:w-(--chat-width)",
            !open && "hidden",
          )}
        >
          <button
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("chat.resize")}
            title={t("chat.dragToResize")}
            onPointerDown={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDoubleClick={() => {
              setExpanded(false);
              setWidth(DEFAULT_WIDTH);
            }}
            onKeyDown={(event) => {
              // The keyboard way to resize: the arrows move the edge, as dragging does.
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              const step = event.key === "ArrowLeft" ? 32 : -32;
              const current = expanded ? window.innerWidth : width;
              const next = current + step;
              if (next >= window.innerWidth - FULL_SLACK) setExpanded(true);
              else {
                setExpanded(false);
                setWidth(Math.max(MIN_WIDTH, next));
              }
            }}
            className="group focus-visible:ring-ring absolute top-0 bottom-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none sm:block"
          >
            <span
              className={cn(
                "bg-border-strong absolute top-0 left-1/2 h-full w-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
                dragging && "opacity-100",
              )}
            />
          </button>
          <ChatPanel
            userId={userId}
            onClose={() => setOpen(false)}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
            adoptRef={adoptRef}
          />
        </aside>
      ) : null}
    </>
  );
}

"use client";

import {
  Download,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  searchThreads,
  type ThreadMatch,
  type ThreadMeta,
} from "@/lib/ai-chat-store";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Group = "pinned" | "today" | "yesterday" | "week" | "older";
const GROUP_KEY: Record<Group, string> = {
  pinned: "chat.groupPinned",
  today: "chat.groupToday",
  yesterday: "chat.groupYesterday",
  week: "chat.groupWeek",
  older: "chat.groupOlder",
};

const DAY = 24 * 60 * 60 * 1000;
/** How far a finger moves sideways for it to be a swipe. */
const SWIPE = 60;

/** The threads in groups by when they were last used, pinned ones first. */
export function groupThreads(
  threads: ThreadMeta[],
  now = Date.now(),
): { group: Group; threads: ThreadMeta[] }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const groupOf = (meta: ThreadMeta): Group => {
    if (meta.pinned) return "pinned";
    if (meta.updatedAt >= today) return "today";
    if (meta.updatedAt >= today - DAY) return "yesterday";
    if (meta.updatedAt >= today - 7 * DAY) return "week";
    return "older";
  };
  const order: Group[] = ["pinned", "today", "yesterday", "week", "older"];
  return order
    .map((group) => ({
      group,
      threads: threads.filter((meta) => groupOf(meta) === group),
    }))
    .filter((part) => part.threads.length > 0);
}

const WIDTH_KEY = "wikihub:chat-threads-width";
export const LIST_WIDTH = 260;
export const LIST_MIN_WIDTH = 200;
export const LIST_MAX_WIDTH = 480;
/** How far the arrow keys move the edge. */
const LIST_STEP = 16;

const clampWidth = (width: number) =>
  Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, Math.round(width)));

function readListWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return stored ? clampWidth(stored) : LIST_WIDTH;
  } catch {
    return LIST_WIDTH;
  }
}

/** The width of the list beside the conversation: dragged by its right edge, and kept. */
function useListWidth() {
  const [width, setWidth] = useState(readListWidth);
  // Where a drag started: the pointer and the width then.
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) =>
      setWidth(clampWidth(drag.width + event.clientX - drag.x));
    const stop = () => setDrag(null);
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
  }, [drag]);

  useEffect(() => {
    if (drag) return;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // not kept
    }
  }, [drag, width]);

  return { width, setWidth, dragging: drag !== null, setDrag };
}

/** Text with the found words marked. */
function Marked({ text, at }: { text: string; at?: [number, number] }) {
  if (!at) return <>{text}</>;
  return (
    <>
      {text.slice(0, at[0])}
      <mark className="bg-primary/25 text-primary rounded-xs px-0.5 font-semibold">
        {text.slice(at[0], at[1])}
      </mark>
      {text.slice(at[1])}
    </>
  );
}

/** A thread's name being changed: Enter or leaving keeps it, Escape does not. */
export function ThreadNameInput({
  title,
  onDone,
  className,
}: {
  title: string;
  /** The new name, or nothing when the name stays. */
  onDone: (title?: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape ends the editing, and the blur that follows must not keep the name after all.
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = name.trim();
    onDone(keep && next && next !== title ? next : undefined);
  };

  return (
    <input
      ref={inputRef}
      aria-label={t("chat.threadRenameLabel")}
      value={name}
      maxLength={120}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      className={cn(
        "border-border bg-surface focus-visible:ring-ring h-8 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    />
  );
}

function ThreadItem({
  meta,
  active,
  running,
  unread,
  match,
  onSelect,
  onRename,
  onTogglePin,
  onExport,
  onDelete,
}: {
  meta: ThreadMeta;
  active: boolean;
  running: boolean;
  /** A reply arrived that has not been looked at. */
  unread: boolean;
  match?: ThreadMatch;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const startRename = () => setRenaming(true);

  if (renaming) {
    return (
      <li className="px-1">
        <ThreadNameInput
          title={meta.title}
          onDone={(title) => {
            setRenaming(false);
            if (title) onRename(title);
          }}
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group/thread relative flex items-center rounded-md transition-colors duration-150",
        active
          ? "bg-surface-selected text-foreground"
          : "text-foreground/90 hover:bg-surface-hover",
      )}
    >
      <button
        type="button"
        data-thread-item
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            startRename();
          } else if (event.key === "Delete") {
            event.preventDefault();
            onDelete();
          }
        }}
        className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md py-1.5 pr-8 pl-2.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className={cn("truncate", active && "font-medium")}>
            {meta.title}
          </span>
          {running ? (
            <Loader2
              className="text-primary size-3 shrink-0 animate-spin motion-reduce:animate-none"
              aria-label={t("chat.threadRunning")}
            />
          ) : unread ? (
            <span
              role="img"
              aria-label={t("chat.threadUnread")}
              className="bg-primary size-2 shrink-0 rounded-full"
            />
          ) : null}
        </span>
        {match?.snippet ? (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            <Marked text={match.snippet} at={match.at} />
          </span>
        ) : null}
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t("chat.threadMenu", { title: meta.title })}
          className={cn(
            "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring data-[state=open]:bg-surface-hover data-[state=open]:text-foreground absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-md transition-[opacity,colors] duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none data-[state=open]:opacity-100",
            // Always there on touch screens; on hover or focus elsewhere.
            "opacity-100 sm:opacity-0 sm:group-focus-within/thread:opacity-100 sm:group-hover/thread:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={startRename}>
            <Pencil className="size-4" aria-hidden />
            {t("chat.threadRename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onTogglePin}>
            {meta.pinned ? (
              <PinOff className="size-4" aria-hidden />
            ) : (
              <Pin className="size-4" aria-hidden />
            )}
            {meta.pinned ? t("chat.threadUnpin") : t("chat.threadPin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport}>
            <Download className="size-4" aria-hidden />
            {t("chat.threadExport")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            {t("chat.threadDelete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** The list folded away beside a wide panel: a strip with what it is most used for. */
export function ChatThreadRail({
  unread,
  onExpand,
  onNew,
  onSearch,
}: {
  /** A reply waits in one of the threads folded away. */
  unread: boolean;
  onExpand: () => void;
  onNew: () => void;
  onSearch: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("chat.threads")}
      className="border-border bg-surface-sunken flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2"
    >
      <Button
        variant="subtle"
        size="icon"
        onClick={onExpand}
        aria-label={t("chat.showThreads")}
        title={t("chat.showThreads")}
        aria-expanded={false}
        className="relative"
      >
        <PanelLeftOpen className="size-4" aria-hidden />
        {unread ? (
          <span
            role="img"
            aria-label={t("chat.threadUnread")}
            className="bg-primary absolute top-1 right-1 size-2 rounded-full"
          />
        ) : null}
      </Button>
      <Button
        variant="subtle"
        size="icon"
        onClick={onNew}
        aria-label={t("chat.newChat")}
        title={t("chat.newChat")}
      >
        <SquarePen className="size-4" aria-hidden />
      </Button>
      <Button
        variant="subtle"
        size="icon"
        onClick={onSearch}
        aria-label={t("chat.searchThreads")}
        title={t("chat.searchThreads")}
      >
        <Search className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}

/**
 * The person's threads with the assistant: a new chat, a search through names and what was
 * said, and the threads grouped by when they were last used. Drawn beside the conversation when
 * the panel is wide, over it when it is narrow.
 */
export function ChatThreadList({
  userId,
  threads,
  activeId,
  running,
  unread,
  onSelect,
  onNew,
  onAsk,
  onRename,
  onTogglePin,
  onExport,
  onDelete,
  onClose,
  onCollapse,
  focusSearch,
  overlay,
  className,
}: {
  userId: string;
  threads: ThreadMeta[];
  activeId: string;
  running: string[];
  unread: string[];
  /** Open a thread; ``entryId`` is the turn that matched a search, to scroll to. */
  onSelect: (id: string, entryId?: string) => void;
  onNew: () => void;
  /** Nothing matched: ask the assistant the words searched for, in a new chat. */
  onAsk: (question: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  /** Hide the list (the button in the list itself, when it is drawn over the conversation). */
  onClose?: () => void;
  /** Fold the list beside the conversation into a strip of icons. */
  onCollapse?: () => void;
  /** Put the caret in the search box when the list appears. */
  focusSearch?: boolean;
  overlay?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [deleting, setDeleting] = useState<ThreadMeta | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Searching reads the threads again, so a change in one shows in the results.
  const matches = useMemo(
    () => (debounced.trim() ? searchThreads(userId, debounced) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- threads: read again when they change
    [userId, debounced, threads],
  );
  const groups = useMemo(() => groupThreads(threads), [threads]);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const size = useListWidth();

  // Drawn over the conversation, a swipe to the left puts the list away.
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Ctrl+K (or Cmd+K) in the panel goes to the search box.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        listRef.current
          ?.closest("[data-chat-panel]")
          ?.contains(document.activeElement)
      ) {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /** Up and down walk the threads, as in a menu. */
  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-thread-item]") ??
        [],
    );
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(at + 1, items.length - 1)
        : Math.max(at - 1, 0);
    items[at < 0 ? 0 : next]?.focus();
  };

  const item = (meta: ThreadMeta, match?: ThreadMatch) => (
    <ThreadItem
      key={meta.id}
      meta={meta}
      match={match}
      active={meta.id === activeId}
      running={running.includes(meta.id)}
      unread={unread.includes(meta.id)}
      onSelect={() => onSelect(meta.id, match?.entryId)}
      onRename={(title) => onRename(meta.id, title)}
      onTogglePin={() => onTogglePin(meta.id)}
      onExport={() => onExport(meta.id)}
      onDelete={() => setDeleting(meta)}
    />
  );

  return (
    <nav
      id="wikihub-chat-threads"
      aria-label={t("chat.threads")}
      onTouchStart={(event) => {
        const at = event.touches[0];
        touch.current = at ? { x: at.clientX, y: at.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const from = touch.current;
        const to = event.changedTouches[0];
        touch.current = null;
        if (!overlay || !onClose || !from || !to) return;
        const across = to.clientX - from.x;
        // Mostly sideways: scrolling the list must not close it.
        if (across < -SWIPE && -across > 2 * Math.abs(to.clientY - from.y)) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        // Escape first puts away the list drawn over the conversation; the panel stays.
        if (
          event.key === "Escape" &&
          overlay &&
          onClose &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          onClose();
        }
      }}
      style={overlay ? undefined : { width: size.width }}
      className={cn(
        "border-border bg-surface-sunken flex min-h-0 shrink-0 flex-col border-r",
        // Beside the conversation it never leaves that less than a phone's width.
        overlay
          ? "absolute inset-y-0 left-0 z-20 w-full shadow-xl sm:w-64"
          : "relative max-w-[calc(100%-20rem)]",
        className,
      )}
    >
      {overlay ? null : (
        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("chat.resizeThreads")}
          aria-valuenow={size.width}
          aria-valuemin={LIST_MIN_WIDTH}
          aria-valuemax={LIST_MAX_WIDTH}
          title={t("chat.dragToResize")}
          onPointerDown={(event) => {
            event.preventDefault();
            size.setDrag({ x: event.clientX, width: size.width });
          }}
          onDoubleClick={() => size.setWidth(LIST_WIDTH)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const step = event.key === "ArrowRight" ? LIST_STEP : -LIST_STEP;
            size.setWidth(clampWidth(size.width + step));
          }}
          className="group/edge focus-visible:ring-ring absolute top-0 right-0 bottom-0 z-10 w-2 translate-x-1/2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-none"
        >
          <span
            className={cn(
              "bg-border-strong absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100",
              size.dragging && "opacity-100",
            )}
          />
        </button>
      )}
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <Button
          variant="subtle"
          size="sm"
          onClick={onNew}
          className="flex-1 justify-start"
        >
          <SquarePen aria-hidden />
          {t("chat.newChat")}
        </Button>
        {onCollapse ? (
          <Button
            variant="subtle"
            size="icon"
            onClick={onCollapse}
            aria-label={t("chat.hideThreads")}
            title={t("chat.hideThreads")}
            aria-expanded
            aria-controls="wikihub-chat-threads"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </Button>
        ) : null}
        {onClose ? (
          <Button
            variant="subtle"
            size="icon"
            onClick={onClose}
            aria-label={t("chat.hideThreads")}
            title={t("chat.hideThreads")}
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current
                  ?.querySelector<HTMLElement>("[data-thread-item]")
                  ?.focus();
              }
            }}
            placeholder={t("chat.searchThreads")}
            aria-label={t("chat.searchThreads")}
            className="border-border bg-surface placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-full rounded-md border pr-2 pl-8 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
      </div>
      <div
        ref={listRef}
        onKeyDown={onListKey}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {matches ? (
          matches.length ? (
            <ul className="space-y-0.5">
              {matches.map((match) => item(match.meta, match))}
            </ul>
          ) : (
            <div className="text-muted-foreground space-y-2 px-2 py-4 text-sm">
              <p>{t("chat.searchThreadsNone", { query: debounced.trim() })}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onAsk(debounced.trim());
                  setQuery("");
                }}
              >
                {t("chat.askThis")}
              </Button>
            </div>
          )
        ) : groups.length ? (
          groups.map((part) => (
            <section key={part.group} className="mt-2 first:mt-0">
              <h3 className="text-muted-foreground px-2.5 py-1 text-xs font-medium">
                {t(GROUP_KEY[part.group])}
              </h3>
              <ul className="space-y-0.5">
                {part.threads.map((meta) => item(meta))}
              </ul>
            </section>
          ))
        ) : (
          <p className="text-muted-foreground px-2.5 py-4 text-sm">
            {t("chat.threadsEmpty")}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("chat.deleteThreadTitle")}
        description={t("chat.deleteThreadBody", {
          title: deleting?.title ?? "",
        })}
        confirmLabel={t("chat.deleteThreadConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
      />
    </nav>
  );
}

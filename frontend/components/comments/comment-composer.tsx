"use client";

import { Loader2, Lock, SendHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { mentionQueryAt } from "@/lib/comments";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { MentionCandidate } from "@/types/api";

const MAX_LENGTH = 5000;

/**
 * A comment box with ``@mention`` suggestions: typing ``@`` lists the people
 * who can see this page, arrow keys and Enter/Tab pick one. Ctrl/Cmd+Enter
 * sends, Escape cancels (or closes the suggestions first).
 */
export function CommentComposer({
  mentionsUrl,
  initialValue = "",
  placeholder,
  submitLabel,
  autoFocus = false,
  compact = false,
  suggestionsAbove = false,
  onSubmit,
  onCancel,
}: {
  /** ``…/comments/mentionable`` for the page being commented on. */
  mentionsUrl: string;
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  compact?: boolean;
  /** Open the @mention list upward - for a box pinned to the bottom of the screen. */
  suggestionsAbove?: boolean;
  /** Resolves true when the text was accepted (the box then clears). */
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<MentionCandidate[] | null>(null);
  const [active, setActive] = useState(0);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(
    null,
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const requestId = useRef(0);

  useEffect(() => {
    if (!autoFocus) return;
    const box = ref.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [autoFocus]);

  // Grow with the text, up to a cap, instead of showing a scrollbar early.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 240)}px`;
    // Only scroll once the cap is hit; a one-line box must not show arrows.
    box.style.overflowY = box.scrollHeight > 240 ? "auto" : "hidden";
  }, [value]);

  // Look people up (debounced) whenever the caret sits in an ``@name``.
  useEffect(() => {
    if (!mention) {
      requestId.current += 1;
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<MentionCandidate[]>(mentionsUrl, {
          query: { q: mention.query },
        });
        if (id === requestId.current) {
          setSuggestions(found);
          setActive(Math.max(0, found.findIndex((candidate) => candidate.can_view)));
        }
      } catch {
        if (id === requestId.current) setSuggestions([]);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [mention, mentionsUrl]);

  const closeSuggestions = useCallback(() => {
    setMention(null);
    setSuggestions(null);
  }, []);

  function track(next: string, caret: number) {
    const found = mentionQueryAt(next, caret);
    if (found) setMention(found);
    else closeSuggestions();
  }

  /** The next selectable row from ``from`` in ``step`` direction, wrapping;
   * people without access to the page are skipped. */
  function nextSelectable(list: MentionCandidate[], from: number, step: 1 | -1): number {
    for (let offset = 1; offset <= list.length; offset += 1) {
      const index = (from + step * offset + list.length * offset) % list.length;
      if (list[index].can_view) return index;
    }
    return from;
  }

  function pick(candidate: MentionCandidate) {
    const box = ref.current;
    if (!box || !mention || !candidate.can_view) return;
    const caret = box.selectionStart;
    const next = `${value.slice(0, mention.start)}@${candidate.username} ${value.slice(caret)}`;
    const position = mention.start + candidate.username.length + 2;
    setValue(next);
    closeSuggestions();
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(position, position);
    });
  }

  async function submit() {
    const body = value.trim();
    if (!body || pending) return;
    setPending(true);
    try {
      if (await onSubmit(body)) {
        setValue("");
        closeSuggestions();
      }
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME (Vietnamese Telex/VNI included) is still composing a word: its
    // Enter confirms the word and must never send the comment.
    if (event.nativeEvent.isComposing) return;
    // Only someone who can see the page can be picked; a list of nobody but
    // locked-out people lets Enter send the comment as usual.
    const open =
      suggestions !== null && suggestions.some((candidate) => candidate.can_view);
    if (open && event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => nextSelectable(suggestions, index, 1));
    } else if (open && event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => nextSelectable(suggestions, index, -1));
    } else if (open && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      if (suggestions !== null) {
        event.preventDefault();
        closeSuggestions();
      } else if (onCancel) {
        event.preventDefault();
        onCancel();
      }
    } else if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      // Chat-style: Enter sends, Shift+Enter breaks the line. Ctrl/Cmd+Enter
      // keeps working for anyone used to it.
      event.preventDefault();
      void submit();
    }
  }

  const empty = !value.trim();

  return (
    <div className="relative min-w-0 flex-1">
      {/* The send button sits inside the box, at its bottom-right, as in a
          chat - the textarea keeps room for it on the right. */}
      <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={1}
        maxLength={MAX_LENGTH}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-controls={suggestions ? listId : undefined}
        aria-expanded={suggestions !== null}
        disabled={pending}
        className={cn(
          // `block`: an inline textarea leaves a few pixels of line-box
          // gap under it, which pushed the send button below the box.
          "block min-h-9 resize-none rounded-lg py-2 pr-11",
          compact ? "text-[13px]" : "text-sm",
        )}
        onChange={(event) => {
          setValue(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onClick={(event) =>
          track(value, (event.target as HTMLTextAreaElement).selectionStart)
        }
        onBlur={() => setTimeout(closeSuggestions, 120)}
      />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={empty || pending}
          aria-label={submitLabel}
          title={submitLabel}
          className="text-primary hover:bg-primary-subtle active:bg-surface-selected focus-visible:ring-ring absolute right-1.5 bottom-1 flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {suggestions !== null && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("comments.mentionHint")}
          className={cn(
            "border-border bg-surface-raised absolute left-0 z-30 max-h-60 w-72 max-w-full overflow-y-auto rounded-md border p-1 shadow-lg",
            suggestionsAbove ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {suggestions.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-xs">
              {t("comments.mentionNoResults")}
            </li>
          ) : (
            suggestions.map((candidate, index) => (
              <li
                key={candidate.username}
                role="option"
                aria-selected={candidate.can_view && index === active}
                aria-disabled={!candidate.can_view}
              >
                <button
                  type="button"
                  // Keep the caret in the textarea; blur would close the list.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(candidate)}
                  // Not the `disabled` attribute: a disabled button skips the
                  // mousedown guard above, so a click would blur the box and
                  // close the list.
                  aria-disabled={!candidate.can_view}
                  tabIndex={candidate.can_view ? undefined : -1}
                  title={candidate.can_view ? undefined : t("comments.mentionNoAccess")}
                  className={cn(
                    "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                    !candidate.can_view
                      ? null
                      : index === active
                        ? "bg-surface-selected"
                        : "hover:bg-surface-hover active:bg-surface-selected",
                  )}
                >
                  <Avatar
                    name={candidate.full_name}
                    username={candidate.username}
                    src={candidate.avatar_url}
                    className="size-6 text-[10px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {candidate.full_name || candidate.username}
                    </span>
                    {candidate.can_view ? null : (
                      <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                        <Lock className="size-3 shrink-0" aria-hidden />
                        {t("comments.mentionNoAccess")}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    @{candidate.username}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-foreground hidden text-xs sm:inline">
          {t("comments.mentionHint")} · {t("comments.shortcutHint")}
        </span>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onCancel}
            disabled={pending}
          >
            {t("comments.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

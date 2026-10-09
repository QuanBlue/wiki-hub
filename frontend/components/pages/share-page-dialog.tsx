"use client";

import { Link2, Loader2, Lock, Search, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { MentionCandidate, ShareResult } from "@/types/api";

/**
 * "Share with people": pick colleagues and send them a notification that
 * links to the page. People who cannot open the page (a restricted space or
 * page) are listed but disabled - sharing never widens access.
 */
export function SharePageDialog({
  spaceKey,
  pageSlug,
  pageTitle,
  open,
  onOpenChange,
  onCopyLink,
  onShared,
}: {
  spaceKey: string;
  pageSlug: string;
  pageTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopyLink: () => void;
  /** The page's share count after a successful share. */
  onShared: (shareCount: number) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const base = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/shares`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MentionCandidate[] | null>(null);
  const [selected, setSelected] = useState<MentionCandidate[]>([]);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const listId = useId();
  const requestId = useRef(0);

  // A fresh picker every time it opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when reopened
    setQuery("");
    setSelected([]);
    setResults(null);
  }, [open]);

  // Look people up (debounced) as the query changes.
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<MentionCandidate[]>(`${base}/candidates`, {
          query: { q: query },
        });
        if (id !== requestId.current) return;
        setResults(found);
        setActive(Math.max(0, found.findIndex((person) => person.can_view)));
      } catch {
        if (id === requestId.current) setResults([]);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [base, open, query]);

  const isSelected = (person: MentionCandidate) =>
    selected.some((chosen) => chosen.username === person.username);

  function toggle(person: MentionCandidate) {
    if (!person.can_view) return;
    setSelected((current) =>
      isSelected(person)
        ? current.filter((chosen) => chosen.username !== person.username)
        : [...current, person],
    );
  }

  /** The next pickable row from ``from`` in ``step`` direction, wrapping. */
  function nextSelectable(list: MentionCandidate[], from: number, step: 1 | -1): number {
    for (let offset = 1; offset <= list.length; offset += 1) {
      const index = (from + step * offset + list.length * offset) % list.length;
      if (list[index].can_view) return index;
    }
    return from;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !results?.some((person) => person.can_view)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => nextSelectable(results, index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => nextSelectable(results, index, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = results[active];
      if (person) toggle(person);
    }
  }

  async function share() {
    if (selected.length === 0 || pending) return;
    setPending(true);
    try {
      const result = await api.post<ShareResult>(base, {
        recipients: selected.map((person) => person.username),
      });
      onShared(result.share_count);
      // The server answers with usernames; show the names that were picked.
      const named = (usernames: string[]) =>
        usernames
          .map((username) => {
            const person = selected.find(
              (chosen) => chosen.username.toLowerCase() === username.toLowerCase(),
            );
            return person?.full_name || username;
          })
          .join(", ");
      if (result.shared.length > 0) {
        toast.success(t("share.sent", { names: named(result.shared) }));
      }
      // Access can change between picking and sending.
      const missed = [...result.no_access, ...result.not_found];
      if (missed.length > 0) {
        toast.warning(t("share.notSent", { names: named(missed) }));
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(apiErrorText(error, "share.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("share.title")} description={pageTitle}>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("share.searchPlaceholder")}
            role="combobox"
            aria-label={t("share.searchPlaceholder")}
            aria-controls={listId}
            aria-expanded
            aria-autocomplete="list"
            aria-activedescendant={
              results?.[active]?.can_view ? `${listId}-${results[active].username}` : undefined
            }
            className="pl-8"
            autoFocus
          />
        </div>

        {selected.length > 0 ? (
          <ul aria-label={t("share.recipients")} className="mt-3 flex flex-wrap gap-1.5">
            {selected.map((person) => (
              <li
                key={person.username}
                className="bg-primary-subtle text-primary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs font-medium"
              >
                {person.full_name || person.username}
                <button
                  type="button"
                  onClick={() => toggle(person)}
                  aria-label={t("share.remove", { name: person.full_name || person.username })}
                  className="hover:bg-primary/15 active:bg-primary/25 focus-visible:ring-ring flex size-5 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <ul
          id={listId}
          role="listbox"
          aria-multiselectable
          aria-label={t("share.people")}
          className="border-border mt-3 max-h-64 overflow-y-auto rounded-md border p-1"
        >
          {results === null ? (
            <li className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("share.searching")}
            </li>
          ) : results.length === 0 ? (
            <li className="text-muted-foreground px-2 py-2 text-sm">{t("share.noResults")}</li>
          ) : (
            results.map((person, index) => {
              const chosen = isSelected(person);
              return (
                <li
                  key={person.username}
                  id={`${listId}-${person.username}`}
                  role="option"
                  aria-selected={chosen}
                  aria-disabled={!person.can_view}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => toggle(person)}
                    aria-disabled={!person.can_view}
                    title={person.can_view ? undefined : t("share.noAccess")}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150",
                      "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                      !person.can_view
                        ? null
                        : index === active
                          ? "bg-surface-hover"
                          : "hover:bg-surface-hover active:bg-surface-selected",
                      chosen && "text-primary",
                    )}
                  >
                    <Avatar
                      name={person.full_name}
                      username={person.username}
                      src={person.avatar_url}
                      className="size-7 text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{person.full_name || person.username}</span>
                      <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                        {person.can_view ? (
                          `@${person.username}`
                        ) : (
                          <>
                            <Lock className="size-3 shrink-0" aria-hidden />
                            {t("share.noAccess")}
                          </>
                        )}
                      </span>
                    </span>
                    {chosen ? (
                      <span className="text-primary text-xs font-medium">{t("share.added")}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <DialogFooter className="items-center justify-between">
          <Button type="button" variant="ghost" onClick={onCopyLink}>
            <Link2 />
            {t("share.copyLink")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void share()}
            disabled={selected.length === 0 || pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {selected.length > 0
              ? t("share.sendCount", { count: selected.length })
              : t("share.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

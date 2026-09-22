"use client";

import { ArrowLeftRight, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Me, Page, User } from "@/types/api";

/**
 * Pick an account to view WikiHub as.
 *
 * Impersonation, not a second login: no password is exchanged, the switch is
 * audited at both ends, and every action taken meanwhile records the
 * administrator behind it. The banner in the top bar is the standing reminder
 * that the session is borrowed.
 *
 * The list excludes the protected bootstrap account and the caller, because the
 * backend refuses both — offering a row that can only 403 is worse than not
 * offering it.
 */
export function SwitchAccountMenu({
  currentUser,
  canSwitch,
  onSwitched,
}: {
  currentUser: Me;
  canSwitch: boolean;
  onSwitched: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { t, apiErrorText } = useTranslation();

  useEffect(() => {
    if (!expanded || !canSwitch) return;

    // Debounced and re-run on every keystroke: the workspace can hold far
    // more accounts than a single page, so matching only has to search
    // whatever page happened to load first (a client-side substring filter
    // over a capped snapshot) misses anyone outside it. Searching the
    // backend directly, like the People directory and the create-user
    // dialog already do, is correct at any workspace size.
    let stale = false;
    const q = searchQuery.trim();
    const timer = window.setTimeout(
      () => {
        api
          .get<Page<User>>(
            `/api/v1/users?limit=100&status=active${q ? `&q=${encodeURIComponent(q)}` : ""}`,
          )
          .then((page) => {
            if (!stale) {
              setError(null);
              setUsers(page.items);
            }
          })
          .catch((err: unknown) => {
            if (stale) return;
            setUsers([]);
            setError(apiErrorText(err, "switchAccount.loadError"));
          });
      },
      q ? 250 : 0,
    );

    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [canSwitch, expanded, searchQuery, apiErrorText]);

  async function switchTo(user: User) {
    setSwitching(user.id);
    try {
      await api.post<unknown>("/api/v1/auth/impersonate", {
        user_id: user.id,
      });
      setExpanded(false);
      onSwitched();
      // The cookie changed, so every server-rendered page is now stale.
      router.replace("/");
      router.refresh();
    } catch (err) {
      toast.error(apiErrorText(err, "switchAccount.switchError"));
      setSwitching(null);
    }
  }

  // The backend already applied `q`, so this only needs to drop the two
  // rows it can't offer: the caller themselves and the protected bootstrap
  // account (both of which the backend would 403 on anyway).
  const selectable = (users ?? []).filter(
    (user) => user.id !== currentUser.id && !user.is_protected,
  );
  const hasQuery = searchQuery.trim().length > 0;

  const avatarStyle = (user: User) =>
    user.avatar_url
      ? { backgroundImage: `url(${user.avatar_url})`, backgroundSize: "cover" }
      : undefined;
  const initials = (user: User) =>
    (user.full_name.trim() || user.username).slice(0, 1).toUpperCase();

  return (
    <div className="p-2">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={avatarStyle(currentUser)}
        >
          {currentUser.avatar_url ? null : initials(currentUser)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {currentUser.full_name || currentUser.username}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            @{currentUser.username}
          </span>
        </span>
        {canSwitch ? (
          <Popover open={expanded} onOpenChange={setExpanded}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={t("switchAccount.switchAccount")}
                title={t("switchAccount.switchAccount")}
                className={cn(
                  "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  expanded
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                )}
              >
                <ArrowLeftRight className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="left"
              align="start"
              sideOffset={12}
              alignOffset={-4}
              data-switch-account-popup=""
              className="w-80 overflow-hidden rounded-xl border border-border bg-surface p-0 shadow-2xl z-50 animate-in fade-in-0 zoom-in-95"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/80 bg-surface-sunken/60 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shrink-0">
                    <ArrowLeftRight className="size-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-foreground leading-tight">
                      {t("switchAccount.switchTitle")}
                    </h4>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {t("switchAccount.switchSubtitle")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors cursor-pointer"
                  aria-label={t("switchAccount.close")}
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Quick Filter Search Bar */}
              <div className="p-2 border-b border-border/60 bg-surface">
                <div className="relative flex items-center">
                  <Search className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        if (searchQuery) {
                          setSearchQuery("");
                          e.preventDefault();
                        } else {
                          setExpanded(false);
                        }
                      }
                    }}
                    placeholder={t("switchAccount.searchPlaceholder")}
                    className="bg-surface-sunken/60 text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-8 w-full rounded-lg pr-7 pl-8 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none border border-border/60"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="text-muted-foreground hover:text-foreground absolute right-2 rounded p-0.5 cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* User List Body */}
              <div className="max-h-64 overflow-y-auto p-1.5 wh-scroll">
                {users === null ? (
                  <p className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    {t("switchAccount.loadingAccounts")}
                  </p>
                ) : error ? (
                  <p className="text-danger py-4 px-3 text-center text-xs">{error}</p>
                ) : selectable.length === 0 && !hasQuery ? (
                  <p className="text-muted-foreground py-6 text-center text-xs">
                    {t("switchAccount.noOtherAccounts")}
                  </p>
                ) : selectable.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    <p>{t("switchAccount.noMatches")}</p>
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="text-primary hover:underline mt-1 text-[11px] cursor-pointer"
                    >
                      {t("switchAccount.clearSearch") || "Clear search"}
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {selectable.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          disabled={switching !== null}
                          onClick={() => void switchTo(user)}
                          className={cn(
                            "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
                            "focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                            switching === user.id && "bg-surface-selected",
                          )}
                        >
                          <span
                            className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                            style={avatarStyle(user)}
                          >
                            {user.avatar_url ? null : initials(user)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {user.full_name || user.username}
                            </span>
                            <span className="text-muted-foreground block truncate text-[11px]">
                              @{user.username}
                            </span>
                          </span>
                          {switching === user.id ? (
                            <Loader2 className="text-primary size-3.5 animate-spin shrink-0" />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Security Audit Footer */}
              <div className="border-t border-border/60 bg-surface-sunken/40 px-3 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3 text-primary shrink-0" />
                  {t("switchAccount.auditNote")}
                </span>
                <span className="font-medium text-foreground/80">
                  {selectable.length}
                </span>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

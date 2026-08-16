"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api-client";
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
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || !canSwitch || users !== null) return;

    let stale = false;
    api
      .get<Page<User>>("/api/v1/users?limit=20&status=active")
      .then((page) => {
        if (!stale) {
          setError(null);
          setUsers(page.items);
        }
      })
      .catch((err: unknown) => {
        if (stale) return;
        setUsers([]);
        setError(
          err instanceof ApiError ? err.message : "Could not load accounts.",
        );
      });

    return () => {
      stale = true;
    };
  }, [canSwitch, expanded, users]);

  async function switchTo(user: User) {
    setSwitching(user.id);
    try {
      await api.post<unknown>("/api/v1/auth/impersonate", {
        user_id: user.id,
      });
      onSwitched();
      // The cookie changed, so every server-rendered page is now stale.
      router.replace("/");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not switch account.",
      );
      setSwitching(null);
    }
  }

  const selectable = (users ?? []).filter(
    (user) => user.id !== currentUser.id && !user.is_protected,
  );

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
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label="Switch account"
            className="bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeftRight className="size-4" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-border bg-surface mt-1 overflow-hidden rounded-lg border shadow-sm">
          {users === null ? (
            <p className="text-muted-foreground flex items-center gap-2 px-3 py-3 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading accounts…
            </p>
          ) : error ? (
            <p className="text-danger px-3 py-3 text-sm">{error}</p>
          ) : selectable.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-sm">
              No other active accounts.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto p-1">
              {selectable.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    disabled={switching !== null}
                    onClick={() => void switchTo(user)}
                    className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      style={avatarStyle(user)}
                    >
                      {user.avatar_url ? null : initials(user)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {user.full_name || user.username}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        @{user.username}
                      </span>
                    </span>
                    {switching === user.id ? (
                      <Loader2 className="text-muted-foreground size-4 animate-spin" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

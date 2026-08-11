"use client";

import { Loader2, Search, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import type { Page, User } from "@/types/api";

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
export function SwitchAccountDialog({
  open,
  onOpenChange,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    // Debounced so typing does not fire a request per keystroke. The cleanup
    // both cancels the pending timer and marks a resolved response stale, so a
    // slow early request cannot overwrite the results of a later one.
    let stale = false;
    const timer = setTimeout(
      () => {
        setError(null);
        api
          .get<Page<User>>(
            `/api/v1/users?limit=20&status=active${
              query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""
            }`,
          )
          .then((page) => {
            if (!stale) setUsers(page.items);
          })
          .catch((err: unknown) => {
            if (stale) return;
            setUsers([]);
            setError(
              err instanceof ApiError
                ? err.message
                : "Could not load the user list.",
            );
          });
      },
      query ? 250 : 0,
    );

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  async function switchTo(user: User) {
    setSwitching(user.id);
    try {
      await api.post<unknown>("/api/v1/auth/impersonate", {
        user_id: user.id,
      });
      onOpenChange(false);
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
    (user) => user.id !== currentUserId && !user.is_protected,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Switch account"
        description="View WikiHub as another user without signing out. Everything you do is recorded against your own name."
        className="max-w-lg"
      >
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, username or e-mail…"
            className="pl-8"
            aria-label="Search accounts"
          />
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto">
          {users === null ? (
            <p className="text-muted-foreground flex items-center gap-2 px-1 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading accounts…
            </p>
          ) : error ? (
            <p className="text-danger px-1 py-6 text-sm">{error}</p>
          ) : selectable.length === 0 ? (
            <p className="text-muted-foreground px-1 py-6 text-sm">
              {query
                ? "No active accounts match that search."
                : "There are no other active accounts to switch to."}
            </p>
          ) : (
            <ul className="space-y-1">
              {selectable.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    disabled={switching !== null}
                    onClick={() => void switchTo(user)}
                    className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {(user.full_name.trim() || user.username)
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {user.full_name || user.username}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        @{user.username}
                        {user.is_superuser ? " · Administrator" : ""}
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

        <p className="text-muted-foreground border-border mt-3 flex gap-2 border-t pt-3 text-xs">
          <ShieldAlert className="mt-px size-4 shrink-0" />
          <span>
            Actions you take while switched are attributed to that account
            <em> and </em>
            to you in the audit log. Return to your own account from the same
            menu.
          </span>
        </p>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

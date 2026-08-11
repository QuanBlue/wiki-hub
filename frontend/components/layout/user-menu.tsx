"use client";

import { ChevronDown, LogOut, Undo2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwitchAccountMenu } from "@/components/layout/switch-account-dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Me, User } from "@/types/api";

function initials(user: User): string {
  const source = user.full_name.trim() || user.username;
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/**
 * Avatar + account menu.
 *
 * Everything account-related lives behind one trigger rather than sitting in
 * the bar: a bare "Sign out" button next to a link is both visual noise and a
 * one-click accident, and the row grows unbounded as account actions are added.
 */
export function UserMenu({ user }: { user: Me }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const displayName = user.full_name || user.username;
  const impersonator = user.impersonator;

  async function returnToSelf() {
    setPending(true);
    try {
      await api.delete<unknown>("/api/v1/auth/impersonate");
      router.replace("/");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not return to your account.",
      );
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      // Clears the httpOnly cookie server-side; the client cannot delete it.
      await api.post<void>("/api/v1/auth/logout");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1.5 pl-1 text-sm",
          "transition-colors duration-150",
          "hover:bg-surface-hover active:bg-surface-selected",
          "data-[state=open]:bg-surface-selected",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        )}
        aria-label={`Account menu for ${displayName}`}
      >
        <span
          className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          aria-hidden
          style={
            user.avatar_url
              ? {
                  backgroundImage: `url(${user.avatar_url})`,
                  backgroundSize: "cover",
                }
              : undefined
          }
        >
          {user.avatar_url ? null : initials(user)}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">
          {displayName}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <SwitchAccountMenu
          currentUser={user}
          canSwitch={!impersonator && user.is_superuser}
        />

        {impersonator ? (
          <div className="px-4 pb-2">
            <span className="text-warning block truncate text-xs">
              Signed in as {impersonator.username}
            </span>
          </div>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound />
            Your account
          </Link>
        </DropdownMenuItem>

        {/*
          Two mutually exclusive states. While impersonating, the only account
          move offered is the way back: the backend refuses to nest, so a
          "switch again" entry could only ever fail.
        */}
        {impersonator ? (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => void returnToSelf()}
          >
            <Undo2 />
            Return to {impersonator.username}
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={pending}
          // Radix closes the menu before the request settles, so `onSelect`
          // must not be awaited here; the redirect is the completion signal.
          onSelect={() => void signOut()}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

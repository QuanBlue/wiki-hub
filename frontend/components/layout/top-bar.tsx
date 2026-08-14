"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Wordmark } from "@/components/brand/logo";
import { SearchModal } from "@/components/layout/search-modal";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { Me } from "@/types/api";

/**
 * Fixed application header: brand, global search entry point and user actions.
 */
export function TopBar({ siteName, user }: { siteName: string; user: Me }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="h-topbar border-border bg-surface fixed inset-x-0 top-0 z-30 border-b">
      <div className="flex h-full items-center gap-3 px-4">
        <SidebarToggle />

        <Link
          href="/"
          className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring rounded-md px-1 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`${siteName} home`}
        >
          <Wordmark siteName={siteName} />
        </Link>

        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="border-border bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:border-border-strong active:bg-surface-selected flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left transition-colors duration-150"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate text-xs">Search WikiHub</span>
            <kbd className="border-border ml-auto hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

"use client";

import { BookOpen, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Wordmark } from "@/components/brand/logo";
import { SearchModal } from "@/components/layout/search-modal";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { useThemeSettings } from "@/components/theme-color-provider";
import { UserMenu } from "@/components/layout/user-menu";
import { formatBinding, useShortcutBindings } from "@/lib/keyboard-shortcuts";
import { useTranslation } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import type { Me } from "@/types/api";

/**
 * Fixed application header: brand, global search entry point and user actions.
 */
export function TopBar({ siteName: propSiteName, user }: { siteName?: string; user: Me }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const themeSettings = useThemeSettings();
  const { t } = useTranslation();
  const effectiveSiteName = themeSettings?.siteName || propSiteName || "WikiHub";
  // Follows whatever the user has bound, so the hint cannot promise a chord
  // that no longer opens anything. Empty when they have unbound it entirely.
  const searchBindings = useShortcutBindings("search.open");
  const searchHint = searchBindings[0] ? formatBinding(searchBindings[0]) : null;

  return (
    <header className="h-topbar border-border bg-surface fixed inset-x-0 top-0 z-30 border-b">
      <div className="flex h-full items-center gap-3 px-4">
        <SidebarToggle />

        <Link
          href="/"
          className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring rounded-md px-1 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          aria-label={t("topbar.homeAria", { siteName: effectiveSiteName })}
        >
          <Wordmark siteName={effectiveSiteName} />
        </Link>

        <div className="mx-auto w-full min-w-0 max-w-md">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="border-border bg-surface-sunken text-muted-foreground hover:bg-surface-hover hover:border-border-strong active:bg-surface-selected flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left transition-colors duration-150"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate text-xs">
              {t("topbar.searchPlaceholder", { siteName: effectiveSiteName })}
            </span>
            {searchHint ? (
              <kbd className="border-border ml-auto hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
                {searchHint}
              </kbd>
            ) : null}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            asChild
            aria-label={t("topbar.help")}
            title={t("topbar.help")}
          >
            <Link href="/help">
              <BookOpen className="size-4" aria-hidden />
            </Link>
          </Button>
          <ThemeToggle />
          <LanguageToggle />
          <UserMenu user={user} />
        </div>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

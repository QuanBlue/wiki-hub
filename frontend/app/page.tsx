import { redirect } from "next/navigation";
import {
  BookOpen,
  Clock3,
  FileArchive,
  FolderPlus,
  Grid2X2,
  Search,
  Settings,
  Star,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpaceList } from "@/components/spaces/space-list";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listFavoriteSpaces, listRecentSpaces } from "@/lib/spaces";
import type { Space } from "@/types/api";

// The dashboard reflects live backend state, so it must never be cached.
export const dynamic = "force-dynamic";

async function loadHomeSpaces(): Promise<{
  favorites: Space[];
  recent: Space[];
}> {
  try {
    const [favorites, recent] = await Promise.all([
      listFavoriteSpaces(),
      listRecentSpaces(),
    ]);
    return { favorites, recent };
  } catch {
    // A dashboard should still be useful when a transient API error prevents
    // these optional collections from loading.
    return { favorites: [], recent: [] };
  }
}

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { favorites, recent } = await loadHomeSpaces();
  const siteName = SITE_NAME;
  const displayName = user.full_name.trim() || user.username;
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const spaces = favorites.length > 0 ? favorites : recent;
  const spaceHeading =
    favorites.length > 0 ? "Starred spaces" : "Pick up where you left off";

  return (
    <AppShell fullWidth siteName={siteName} user={user}>
      <div className="space-y-8">
        {/* Full-width Hero Header */}
        <section className="border-border/80 bg-gradient-to-r from-primary-subtle/80 via-surface to-primary-subtle/30 relative overflow-hidden rounded-2xl border p-6 sm:p-8 shadow-xs">
          <div
            aria-hidden
            className="bg-primary/10 pointer-events-none absolute -top-16 -right-12 size-64 rounded-full blur-3xl"
          />
          <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <p className="text-primary mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                <BookOpen className="size-4" />
                Team Knowledge Base
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Welcome back, {firstName} 👋
              </h1>
              <p className="text-muted-foreground mt-2.5 text-sm sm:text-base leading-relaxed">
                Keep decisions, how-tos, and project context in a central place your whole team can search and access.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <CreateSpaceForm />
                <Button variant="secondary" asChild>
                  <Link href="/spaces">
                    <Grid2X2 className="size-4" />
                    Browse spaces
                  </Link>
                </Button>
              </div>
            </div>

            {/* Hero Quick Stat Box */}
            <div className="border-border/60 bg-surface/80 flex shrink-0 items-center gap-6 rounded-xl border p-4 backdrop-blur-xs">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{recent.length}</div>
                <div className="text-muted-foreground text-xs font-medium">Recent Spaces</div>
              </div>
              <div className="bg-border h-8 w-px" />
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-500">{favorites.length}</div>
                <div className="text-muted-foreground text-xs font-medium">Starred</div>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Grid Layout (Full Width: 2 cols + 1 sidebar widget col) */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main Content Area (Left 2 cols) */}
          <div className="space-y-8 lg:col-span-2">
            {/* Spaces Section */}
            <section aria-labelledby="home-spaces-heading">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 id="home-spaces-heading" className="text-xl font-bold text-foreground">
                    {spaceHeading}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {favorites.length > 0
                      ? "The documentation areas you return to most."
                      : "Recently updated documentation areas."}
                  </p>
                </div>
                <Link
                  href={favorites.length > 0 ? "/favorites" : "/recent"}
                  className="text-primary hover:text-primary-hover focus-visible:ring-ring rounded text-sm font-medium transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  View all
                </Link>
              </div>

              {spaces.length > 0 ? (
                <SpaceList spaces={spaces.slice(0, 6)} emptyTitle="" emptyHint="" />
              ) : (
                <div className="border-border bg-surface rounded-xl border border-dashed px-6 py-8">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-foreground">Start your knowledge base</h3>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Create a space for a team, project, or shared topic.
                      </p>
                    </div>
                    <CreateSpaceForm />
                  </div>
                </div>
              )}
            </section>

            {/* Quick Navigation Cards */}
            <section aria-labelledby="getting-started-heading">
              <div className="mb-4">
                <h2 id="getting-started-heading" className="text-xl font-bold text-foreground">
                  Get organised
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  A simple home for the information your team needs every day.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Link
                  href="/spaces"
                  className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-all duration-150 hover:shadow-xs focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-primary-subtle text-primary mb-4 flex size-9 items-center justify-center rounded-lg">
                    <FolderPlus className="size-5" />
                  </span>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    Organise by space
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    Give every team or initiative a clear documentation home.
                  </p>
                </Link>

                <Link
                  href="/recent"
                  className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-all duration-150 hover:shadow-xs focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-info-bg text-info mb-4 flex size-9 items-center justify-center rounded-lg">
                    <Clock3 className="size-5" />
                  </span>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    Continue recent work
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    Return to spaces and pages that changed recently.
                  </p>
                </Link>

                <Link
                  href="/favorites"
                  className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-all duration-150 hover:shadow-xs focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-warning-bg text-amber-500 mb-4 flex size-9 items-center justify-center rounded-lg">
                    <Star className="size-5 fill-current" />
                  </span>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    Save key knowledge
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    Star the spaces and pages your team relies on most.
                  </p>
                </Link>
              </div>
            </section>
          </div>

          {/* Right Sidebar Widgets (Right 1 col) */}
          <div className="space-y-6 lg:col-span-1">
            {/* Search Widget */}
            <div className="border-border bg-surface rounded-xl border p-5 shadow-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Search className="text-primary size-4" />
                Quick Search
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                Find spaces, page titles, or content keywords across the entire WikiHub instantly.
              </p>
              <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                <span className="text-muted-foreground">Press shortcut</span>
                <kbd className="border-border text-muted-foreground bg-surface rounded border px-2 py-0.5 font-mono text-[11px]">
                  ⌘K or Ctrl+K
                </kbd>
              </div>
            </div>

            {/* Quick Actions & Admin Tools */}
            <div className="border-border bg-surface rounded-xl border p-5 shadow-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Zap className="text-amber-500 size-4" />
                Quick Actions
              </div>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <Link
                    href="/admin/backup"
                    className="hover:bg-surface-hover hover:text-foreground text-muted-foreground flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors"
                  >
                    <FileArchive className="size-4 text-primary" />
                    <span>Confluence Archive Import</span>
                  </Link>
                </li>
                {user.is_superuser ? (
                  <li>
                    <Link
                      href="/admin/settings"
                      className="hover:bg-surface-hover hover:text-foreground text-muted-foreground flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors"
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      <span>Instance Settings</span>
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import {
  BookOpen,
  Clock3,
  FileArchive,
  FolderPlus,
  Grid2X2,
  Layers,
  Search,
  ShieldCheck,
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
      <div className="space-y-6">
        {/* Header & Application Overview Section (Compact) */}
        <section className="border-border bg-surface rounded-lg border p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="max-w-3xl space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <BookOpen className="size-3" />
                Enterprise Knowledge Platform
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Welcome back, {firstName}
              </h1>
              <p className="text-muted-foreground text-xs leading-relaxed">
                WikiHub is your team&apos;s central documentation workspace. Organize architecture decisions, project runbooks, operational guides, and technical specifications into structured spaces with full-text search and seamless Confluence import.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <CreateSpaceForm />
              <Button size="sm" variant="secondary" asChild>
                <Link href="/spaces">
                  <Grid2X2 className="size-3.5" />
                  Browse spaces
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/admin/backup">
                  <FileArchive className="size-3.5" />
                  Confluence import
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Feature Overview Grid (Compact 4 Columns) */}
        <section aria-labelledby="features-heading" className="space-y-2.5">
          <div>
            <h2 id="features-heading" className="text-base font-bold text-foreground">
              Core Capabilities
            </h2>
            <p className="text-muted-foreground text-xs">
              Built for engineering and product teams to maintain documentation with ease.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-border bg-surface rounded-lg border p-3.5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-primary-subtle text-primary mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Layers className="size-3.5" />
              </div>
              <h3 className="font-semibold text-foreground text-xs">Spaces &amp; Hierarchy</h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Dedicated spaces for teams and systems with nested page trees and granular member access.
              </p>
            </div>

            <div className="border-border bg-surface rounded-lg border p-3.5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-info-bg text-info mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Search className="size-3.5" />
              </div>
              <h3 className="font-semibold text-foreground text-xs">Instant Search (⌘K)</h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Lightning fast global search across space keys, titles, and body content with term highlights.
              </p>
            </div>

            <div className="border-border bg-surface rounded-lg border p-3.5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-warning-bg text-warning mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Zap className="size-3.5" />
              </div>
              <h3 className="font-semibold text-foreground text-xs">Rich Text &amp; Code Blocks</h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                WYSIWYG editor with line-numbered code blocks, callouts, tables, and dual Markdown/HTML modes.
              </p>
            </div>

            <div className="border-border bg-surface rounded-lg border p-3.5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-surface-sunken text-foreground mb-2.5 flex size-7 items-center justify-center rounded-md border border-border">
                <ShieldCheck className="size-3.5" />
              </div>
              <h3 className="font-semibold text-foreground text-xs">Confluence Migration</h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                One-click import of Confluence ZIP archives preserving page hierarchies, callouts, and user metadata.
              </p>
            </div>
          </div>
        </section>

        {/* Spaces Section (Compact Full Width Grid) */}
        <section aria-labelledby="home-spaces-heading" className="space-y-2.5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="home-spaces-heading" className="text-base font-bold text-foreground">
                {spaceHeading}
              </h2>
              <p className="text-muted-foreground text-xs">
                {favorites.length > 0
                  ? "The documentation areas you return to most."
                  : "Recently updated documentation areas."}
              </p>
            </div>
            <Link
              href={favorites.length > 0 ? "/favorites" : "/recent"}
              className="text-primary hover:text-primary-hover focus-visible:ring-ring rounded text-xs font-medium transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              View all
            </Link>
          </div>

          {spaces.length > 0 ? (
            <SpaceList spaces={spaces.slice(0, 8)} emptyTitle="" emptyHint="" />
          ) : (
            <div className="border-border bg-surface rounded-lg border border-dashed px-4 py-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-xs text-foreground">Start your knowledge base</h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    Create a space for a team, project, or shared topic.
                  </p>
                </div>
                <CreateSpaceForm />
              </div>
            </div>
          )}
        </section>

        {/* Getting Started / Quick Navigation Section (Compact) */}
        <section aria-labelledby="getting-started-heading" className="space-y-2.5">
          <div>
            <h2 id="getting-started-heading" className="text-base font-bold text-foreground">
              Get organised
            </h2>
            <p className="text-muted-foreground text-xs">
              A simple home for the information your team needs every day.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/spaces"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-3.5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-primary-subtle text-primary mb-2.5 flex size-7 items-center justify-center rounded-md">
                <FolderPlus className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Organise by space
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Give every team, project, or initiative a clear home.
              </p>
            </Link>

            <Link
              href="/recent"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-3.5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-info-bg text-info mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Clock3 className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Continue recent work
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Return to spaces and pages that have changed recently.
              </p>
            </Link>

            <Link
              href="/favorites"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-3.5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-warning-bg text-warning mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Star className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Save key knowledge
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Star the spaces and pages your team relies on most.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

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
      <div className="space-y-10">
        {/* Header & Application Overview Section */}
        <section className="border-border bg-surface rounded-xl border p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-sunken px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                <BookOpen className="size-3.5" />
                Enterprise Knowledge Platform
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Welcome back, {firstName}
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                WikiHub is your team&apos;s central documentation workspace. Organize architecture decisions, project runbooks, operational guides, and technical specifications into structured spaces with full-text search and seamless Confluence import.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0 pt-2 lg:pt-0">
              <CreateSpaceForm />
              <Button variant="secondary" asChild>
                <Link href="/spaces">
                  <Grid2X2 />
                  Browse spaces
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/admin/backup">
                  <FileArchive />
                  Confluence import
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Feature Overview Grid (4 Columns) */}
        <section aria-labelledby="features-heading" className="space-y-4">
          <div>
            <h2 id="features-heading" className="text-lg font-bold text-foreground">
              Core Capabilities
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Built for engineering and product teams to maintain documentation with ease.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-border bg-surface rounded-xl border p-5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-primary-subtle text-primary mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <Layers className="size-5" />
              </div>
              <h3 className="font-semibold text-foreground text-sm">Spaces &amp; Hierarchy</h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Dedicated spaces for teams, systems, and projects with nested page trees and granular member access.
              </p>
            </div>

            <div className="border-border bg-surface rounded-xl border p-5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-info-bg text-info mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <Search className="size-5" />
              </div>
              <h3 className="font-semibold text-foreground text-sm">Instant Search (⌘K)</h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Lightning fast global search across space keys, titles, and body content with keyword term highlighting.
              </p>
            </div>

            <div className="border-border bg-surface rounded-xl border p-5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-warning-bg text-warning mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <Zap className="size-5" />
              </div>
              <h3 className="font-semibold text-foreground text-sm">Rich Text &amp; Code Blocks</h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                WYSIWYG rich text editor with line-numbered code blocks, callouts, tables, and raw Markdown/HTML modes.
              </p>
            </div>

            <div className="border-border bg-surface rounded-xl border p-5 transition-colors duration-150 hover:border-border-strong">
              <div className="bg-surface-sunken text-foreground mb-3.5 flex size-9 items-center justify-center rounded-lg border border-border">
                <ShieldCheck className="size-5" />
              </div>
              <h3 className="font-semibold text-foreground text-sm">Confluence Migration</h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                One-click import of Confluence ZIP archives preserving page hierarchies, callouts, code macros, and user metadata.
              </p>
            </div>
          </div>
        </section>

        {/* Spaces Section (Full width 4-column grid on wide screens) */}
        <section aria-labelledby="home-spaces-heading" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="home-spaces-heading" className="text-lg font-bold text-foreground">
                {spaceHeading}
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
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
            <SpaceList spaces={spaces.slice(0, 8)} emptyTitle="" emptyHint="" />
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

        {/* Getting Started / Quick Navigation Section */}
        <section aria-labelledby="getting-started-heading" className="space-y-4">
          <div>
            <h2 id="getting-started-heading" className="text-lg font-bold text-foreground">
              Get organised
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              A simple home for the information your team needs every day.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Link
              href="/spaces"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-primary-subtle text-primary mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <FolderPlus className="size-5" />
              </span>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                Organise by space
              </h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Give every team, project, or initiative a clear home.
              </p>
            </Link>

            <Link
              href="/recent"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-info-bg text-info mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <Clock3 className="size-5" />
              </span>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                Continue recent work
              </h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Return to spaces and pages that have changed recently.
              </p>
            </Link>

            <Link
              href="/favorites"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-xl border p-5 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-warning-bg text-warning mb-3.5 flex size-9 items-center justify-center rounded-lg">
                <Star className="size-5" />
              </span>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                Save key knowledge
              </h3>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Star the spaces and pages your team relies on most.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

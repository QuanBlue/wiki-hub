import { redirect } from "next/navigation";
import { Clock3, FolderPlus, Grid2X2, Star } from "lucide-react";
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
        {/* Header Section (Clean & Minimal) */}
        <section className="border-border bg-surface rounded-lg border p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Welcome back, {firstName}
              </h1>
              <p className="text-muted-foreground text-xs">
                Keep decisions, how-tos, and project context in a central place your whole team can find.
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
            </div>
          </div>
        </section>

        {/* Primary Knowledge Spaces Grid */}
        <section aria-labelledby="home-spaces-heading" className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="home-spaces-heading" className="text-base font-semibold text-foreground">
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

        {/* Quick Navigation Cards */}
        <section aria-labelledby="getting-started-heading" className="space-y-3">
          <div>
            <h2 id="getting-started-heading" className="text-base font-semibold text-foreground">
              Get organised
            </h2>
            <p className="text-muted-foreground text-xs">
              A simple home for the information your team needs every day.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/spaces"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-primary-subtle text-primary mb-2.5 flex size-7 items-center justify-center rounded-md">
                <FolderPlus className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Organise by space
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Give every team or initiative a clear home.
              </p>
            </Link>

            <Link
              href="/recent"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-info-bg text-info mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Clock3 className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Continue recent work
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Return to spaces that have changed most recently.
              </p>
            </Link>

            <Link
              href="/favorites"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-warning-bg text-warning mb-2.5 flex size-7 items-center justify-center rounded-md">
                <Star className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Save key knowledge
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Star the spaces your team relies on most.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import { BookOpen, Clock3, FolderPlus, Grid2X2, Star } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpaceList } from "@/components/spaces/space-list";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { listFavoriteSpaces, listRecentSpaces } from "@/lib/spaces";
import { SITE_NAME } from "@/lib/env";
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
  // The middleware only checks that a cookie exists. This is where the session
  // is actually validated against the backend, so an expired or forged token
  // lands back on the login page instead of rendering the app shell.
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
    <AppShell siteName={siteName} user={user}>
      <div className="space-y-8">
        <section className="border-border bg-surface relative overflow-hidden rounded-xl border px-6 py-7 sm:px-8">
          <div
            aria-hidden
            className="bg-primary/10 pointer-events-none absolute -top-16 -right-12 size-52 rounded-full blur-3xl"
          />
          <div className="relative max-w-xl">
            <p className="text-primary mb-2 flex items-center gap-2 text-sm font-medium">
              <BookOpen className="size-4" />
              Your team knowledge base
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome back, {firstName}.
            </h1>
            <p className="text-muted-foreground mt-2 text-sm sm:text-base">
              Keep decisions, how-tos, and project context in a place your whole
              team can find.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <CreateSpaceForm />
              <Button variant="secondary" asChild>
                <Link href="/spaces">
                  <Grid2X2 />
                  Browse spaces
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="home-spaces-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 id="home-spaces-heading" className="text-lg font-semibold">
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
            <SpaceList spaces={spaces.slice(0, 4)} emptyTitle="" emptyHint="" />
          ) : (
            <div className="border-border bg-surface rounded-lg border border-dashed px-6 py-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium">Start your knowledge base</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Create a space for a team, project, or shared topic.
                  </p>
                </div>
                <CreateSpaceForm />
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="getting-started-heading">
          <div className="mb-3">
            <h2 id="getting-started-heading" className="text-lg font-semibold">
              Get organised
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              A simple home for the information your team needs every day.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/spaces"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,box-shadow,background-color] duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-primary-subtle text-primary mb-4 flex size-8 items-center justify-center rounded-md">
                <FolderPlus className="size-4" />
              </span>
              <h3 className="font-medium">Organise by space</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Give every team or initiative a clear home.
              </p>
            </Link>
            <Link
              href="/recent"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,box-shadow,background-color] duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-info-bg text-info mb-4 flex size-8 items-center justify-center rounded-md">
                <Clock3 className="size-4" />
              </span>
              <h3 className="font-medium">Continue recent work</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Return to spaces that have changed most recently.
              </p>
            </Link>
            <Link
              href="/favorites"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,box-shadow,background-color] duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-warning-bg text-warning mb-4 flex size-8 items-center justify-center rounded-md">
                <Star className="size-4" />
              </span>
              <h3 className="font-medium">Save key knowledge</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Star the spaces your team relies on most.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

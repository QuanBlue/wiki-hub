import { redirect } from "next/navigation";
import { Clock3, FileArchive, FolderPlus, Grid2X2, Star } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const siteName = SITE_NAME;
  const displayName = user.full_name.trim() || user.username;
  const firstName = displayName.split(/\s+/)[0] || displayName;

  return (
    <AppShell fullWidth siteName={siteName} user={user}>
      <div className="space-y-6">
        {/* Header Section */}
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
                Give every team or initiative a clear home in WikiHub.
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
                Return to spaces and documentation areas updated recently.
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

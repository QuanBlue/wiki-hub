import { redirect } from "next/navigation";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FileArchive,
  FolderPlus,
  Grid2X2,
  Lightbulb,
  Search,
  Star,
} from "lucide-react";
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
        {/* Header Orientation Section */}
        <section className="border-border bg-surface rounded-lg border p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="space-y-1 max-w-3xl">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <BookOpen className="size-3" />
                Team Knowledge Base
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Welcome back, {firstName}
              </h1>
              <p className="text-muted-foreground text-xs leading-relaxed">
                WikiHub is your central workspace for team documentation, technical runbooks, architecture decisions, and project guidelines.
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

        {/* Quick Access & Workflows (4 Grid Columns) */}
        <section aria-labelledby="getting-started-heading" className="space-y-3">
          <div>
            <h2 id="getting-started-heading" className="text-base font-semibold text-foreground">
              Get organised
            </h2>
            <p className="text-muted-foreground text-xs">
              Quick access to your team&apos;s daily documentation tools.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Browse and manage dedicated spaces for teams, projects, or initiatives.
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
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Jump back into documentation pages and spaces updated recently.
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
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Access your starred spaces and high-priority documentation quickly.
              </p>
            </Link>

            <Link
              href="/admin/backup"
              className="border-border bg-surface group hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-lg border p-4 transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-surface-sunken text-foreground mb-2.5 flex size-7 items-center justify-center rounded-md border border-border">
                <FileArchive className="size-3.5" />
              </span>
              <h3 className="font-medium text-foreground text-xs group-hover:text-primary transition-colors">
                Confluence import
              </h3>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Upload and migrate Confluence ZIP backup archives seamlessly.
              </p>
            </Link>
          </div>
        </section>

        {/* Global Search & Knowledge Best Practices Section */}
        <section aria-labelledby="best-practices-heading" className="space-y-3">
          <div>
            <h2 id="best-practices-heading" className="text-base font-semibold text-foreground">
              Knowledge Base Tips
            </h2>
            <p className="text-muted-foreground text-xs">
              Best practices for maintaining clean and searchable team documentation.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border-border bg-surface rounded-lg border p-4">
              <div className="text-primary mb-2 flex items-center gap-2 font-medium text-xs">
                <Search className="size-3.5" />
                <span>Instant Search (⌘K / Ctrl+K)</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Use the global search shortcut anytime to find page titles, space keys, or text snippets with keyword highlighting.
              </p>
            </div>

            <div className="border-border bg-surface rounded-xl border p-4">
              <div className="text-info mb-2 flex items-center gap-2 font-medium text-xs">
                <Lightbulb className="size-3.5" />
                <span>Use Callouts &amp; Code Blocks</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Highlight important notes, warnings, and code snippets with line numbers to make technical documentation easy to read.
              </p>
            </div>

            <div className="border-border bg-surface rounded-xl border p-4">
              <div className="text-success mb-2 flex items-center gap-2 font-medium text-xs">
                <CheckCircle2 className="size-3.5" />
                <span>Structured Page Trees</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Organize pages logically under space hierarchies so team members can navigate documentation effortlessly.
              </p>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

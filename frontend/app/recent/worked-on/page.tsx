import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listRecentPages } from "@/lib/pages";

export const metadata: Metadata = { title: "Recently worked on" };
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function RecentlyWorkedOnPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The recent-activity endpoint is workspace-wide; narrow it to pages this
  // user actually touched rather than adding a server-side "mine" filter for
  // a single sidebar entry.
  const activity = await listRecentPages(100);
  const mine = activity.filter((item) => item.user_username === user.username);

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="My work"
          title="Recently worked on"
          description="Pages you've created or edited recently."
        />

        {mine.length === 0 ? (
          <div className="border-border bg-surface rounded-xl border border-dashed p-10 text-center">
            <FileText className="text-muted-foreground mx-auto size-6" aria-hidden />
            <p className="mt-2 text-sm font-medium">No edits yet</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Pages you create or edit will show up here.
            </p>
          </div>
        ) : (
          <ul className="border-border bg-surface divide-border divide-y rounded-xl border">
            {mine.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/spaces/${encodeURIComponent(item.space_key)}/${encodeURIComponent(item.slug)}`}
                  className="hover:bg-surface-hover flex items-center gap-3 px-4 py-3 transition-colors duration-150 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
                >
                  <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {item.space_name} · Updated {formatDate(item.updated_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

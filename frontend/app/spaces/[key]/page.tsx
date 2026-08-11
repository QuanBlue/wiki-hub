import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { getSpace, listSpaceMembers } from "@/lib/spaces";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  return { title: key.toUpperCase() };
}

export default async function SpaceDetailPage({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key } = await params;

  let space;
  let members;
  try {
    [space, members] = await Promise.all([
      getSpace(key),
      listSpaceMembers(key),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
          <Link
            href="/spaces"
            className="hover:text-foreground rounded transition-colors duration-150 hover:underline"
          >
            Spaces
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-foreground">{space.name}</span>
        </nav>

        <div className="flex items-start gap-3">
          <span aria-hidden className="text-3xl leading-none">
            {space.icon || "📄"}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {space.name}
            </h1>
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              <code className="bg-surface-sunken rounded px-1.5 py-0.5 font-mono text-xs">
                {space.key}
              </code>
              {space.status === "archived" ? <span>· archived</span> : null}
              {space.created_by_username ? (
                <span>· created by {space.created_by_username}</span>
              ) : null}
            </p>
          </div>
        </div>

        {space.description ? (
          <p className="text-foreground">{space.description}</p>
        ) : null}

        <section className="border-border bg-surface rounded-lg border p-4">
          <h2 className="font-medium">Pages</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            The page tree and the Tiptap editor arrive in the next phase. This
            space is ready to hold them.
          </p>
        </section>

        <section className="border-border bg-surface rounded-lg border p-4">
          <h2 className="font-medium">
            Members{" "}
            <span className="text-muted-foreground font-normal">
              ({members.length})
            </span>
          </h2>
          <ul className="mt-3 space-y-2">
            {members.map((member) => (
              <li
                key={member.user_id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {member.full_name || member.username}{" "}
                  <span className="text-muted-foreground">
                    @{member.username}
                  </span>
                </span>
                <span className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-xs">
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

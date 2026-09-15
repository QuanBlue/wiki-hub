import { Archive, FolderKanban, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  ListFilters,
  PaginationControls,
} from "@/components/admin/list-controls";
import { AdminSpaceRow } from "@/components/admin/space-row-actions";
import { SummaryMetrics } from "@/components/admin/summary-metrics";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { cn } from "@/lib/utils";
import { listAllUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { listAllSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50, 100] as const;

function TabLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof FolderKanban;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-surface text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </Link>
  );
}

export default async function AdminSpacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };
  const tab = single("tab") === "archived" ? "archived" : "directory";
  const rawQuery = single("q");
  const requestedLimit = Number.parseInt(single("limit") || String(PAGE_SIZE), 10);
  const limit = PAGE_SIZES.includes(requestedLimit as 10 | 25 | 50 | 100)
    ? requestedLimit
    : PAGE_SIZE;
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;

  const me = await getCurrentUser();
  // The layout also admits `manage_users`/`manage_groups` holders (see its
  // own comment) - neither unlocks this page. Unlike Users/Groups, this is
  // a full oversight view of *every* space (archive, permanently delete
  // any of them regardless of per-space role) - deliberately not something
  // `create_space` unlocks either, since that only lets someone create new
  // spaces, not administer every existing one (see `app/spaces/page.tsx`).
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">Permission required</p>
        <p className="text-muted-foreground mt-1 text-sm">
          The Spaces directory requires the{" "}
          <code>System administrator</code> permission. Ask an administrator
          if you need access.
        </p>
      </div>
    );
  }

  const [spaces, users] = await Promise.all([
    listAllSpaces(true),
    listAllUsers(),
  ]);
  const activeSpaces = spaces.filter((space) => space.status === "active");
  const archivedSpaces = spaces.filter((space) => space.status !== "active");
  const members = spaces.reduce(
    (total, space) => total + space.member_count,
    0,
  );
  // Space directory stays the full list, every status included - Archived
  // spaces is a convenience filter on top of it, not a separate population,
  // so a space is never only reachable from one tab. Each tab searches and
  // paginates independently - switching tabs resets both (see the bare
  // `?tab=...` links below), the same way switching tabs on Administration
  // > Users does.
  const scopedSpaces = tab === "archived" ? archivedSpaces : spaces;
  const query = rawQuery.trim().toLowerCase();
  const filteredSpaces = scopedSpaces.filter(
    (space) =>
      !query ||
      (space.name + " " + space.key + " " + space.description)
        .toLowerCase()
        .includes(query),
  );
  const pageSpaces = filteredSpaces.slice(offset, offset + limit);

  return (
    <div className="space-y-5">
      <header className="border-border flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
            Administration
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Spaces</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Review documentation spaces, membership and workspace visibility.
            Permanent deletion is available only here.
          </p>
        </div>
      </header>

      <SummaryMetrics
        label="Space summary"
        items={[
          { icon: FolderKanban, label: "Total spaces", value: spaces.length, tone: "primary" },
          { icon: FolderKanban, label: "Active", value: activeSpaces.length, tone: "success" },
          { icon: Archive, label: "Archived", value: archivedSpaces.length, tone: "warning" },
          { icon: Users, label: "Member assignments", value: members },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          className="border-border bg-surface-sunken flex w-fit shrink-0 items-center rounded-md border p-0.5"
          aria-label="Spaces sections"
        >
          <TabLink href="?tab=directory" active={tab === "directory"} icon={FolderKanban}>
            Space directory ({spaces.length})
          </TabLink>
          <TabLink href="?tab=archived" active={tab === "archived"} icon={Archive}>
            Archived spaces ({archivedSpaces.length})
          </TabLink>
        </nav>
        <CreateSpaceForm users={users} />
      </div>

      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">
              {tab === "archived" ? "Archived spaces" : "Space directory"}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {tab === "archived"
                ? "Hidden from normal navigation and browsing - restore one from its own Edit space, or delete it permanently here."
                : "Open a space to manage its pages, members and access rules."}
            </p>
          </div>
          <Suspense fallback={null}>
            <ListFilters
              searchValue={rawQuery}
              searchPlaceholder="Search spaces"
            />
          </Suspense>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-210 text-sm">
            <thead>
              <tr className="border-border bg-surface-sunken text-muted-foreground border-b text-left">
                <th rowSpan={2} className="w-[35%] px-4 py-3 align-middle font-medium">
                  Space
                </th>
                <th rowSpan={2} className="w-[15%] px-4 py-3 align-middle font-medium">
                  Visibility
                </th>
                <th
                  colSpan={2}
                  className="border-border w-[22%] border-b px-4 py-2 text-center font-medium"
                >
                  Licensed users
                </th>
                <th rowSpan={2} className="w-[12%] py-3 pr-4 pl-8 align-middle font-medium">
                  Status
                </th>
                <th
                  rowSpan={2}
                  className="w-[16%] px-4 py-3 text-right align-middle font-medium"
                >
                  Actions
                </th>
              </tr>
              <tr className="border-border bg-surface-sunken text-muted-foreground border-b text-left">
                <th className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                  Groups
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                  Individual users
                </th>
              </tr>
            </thead>
            <tbody>
              {scopedSpaces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    {tab === "archived" ? (
                      <>
                        <Archive className="text-muted-foreground mx-auto size-7" />
                        <p className="mt-3 font-medium">No archived spaces</p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          Archiving a space (from its own Edit space) moves it
                          here instead of deleting it outright.
                        </p>
                      </>
                    ) : (
                      <>
                        <FolderKanban className="text-muted-foreground mx-auto size-7" />
                        <p className="mt-3 font-medium">No spaces yet</p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          Create a space from the workspace menu to start
                          organizing knowledge.
                        </p>
                      </>
                    )}
                  </td>
                </tr>
              ) : filteredSpaces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="font-medium">No spaces found</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Try a different name or space key.
                    </p>
                  </td>
                </tr>
              ) : (
                pageSpaces.map((space) => (
                  <AdminSpaceRow key={space.id} space={space} users={users} />
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredSpaces.length > 0 ? (
          <div className="border-border bg-surface-sunken border-t px-4 py-3">
            <Suspense fallback={null}>
              <PaginationControls
                total={filteredSpaces.length}
                limit={limit}
                offset={offset}
                pageSizes={[...PAGE_SIZES]}
              />
            </Suspense>
          </div>
        ) : null}
      </section>
    </div>
  );
}

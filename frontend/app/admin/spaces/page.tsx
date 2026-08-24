import { Archive, FolderKanban, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ListFilters,
  PaginationControls,
} from "@/components/admin/list-controls";
import { AdminSpaceRow } from "@/components/admin/space-row-actions";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { listAllUsers } from "@/lib/admin";
import { listAllSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50, 100] as const;

function SummaryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-4 sm:border-r sm:last:border-r-0">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export default async function AdminSpacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : (params.q ?? "");
  const rawLimit = Array.isArray(params.limit) ? params.limit[0] : params.limit;
  const rawOffset = Array.isArray(params.offset)
    ? params.offset[0]
    : params.offset;
  const requestedLimit = Number.parseInt(rawLimit || String(PAGE_SIZE), 10);
  const limit = PAGE_SIZES.includes(requestedLimit as 10 | 25 | 50 | 100)
    ? requestedLimit
    : PAGE_SIZE;
  const offset = Number.parseInt(rawOffset || "0", 10) || 0;
  const [spaces, users] = await Promise.all([
    listAllSpaces(true),
    listAllUsers(),
  ]);
  const active = spaces.filter((space) => space.status === "active").length;
  const archived = spaces.length - active;
  const members = spaces.reduce(
    (total, space) => total + space.member_count,
    0,
  );
  const query = rawQuery.trim().toLowerCase();
  const filteredSpaces = spaces.filter(
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
        <CreateSpaceForm users={users} />
      </header>

      <section
        aria-label="Space summary"
        className="border-border bg-surface grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4"
      >
        <SummaryMetric
          icon={FolderKanban}
          label="Total spaces"
          value={spaces.length}
        />
        <SummaryMetric icon={FolderKanban} label="Active" value={active} />
        <SummaryMetric icon={Archive} label="Archived" value={archived} />
        <SummaryMetric
          icon={Users}
          label="Member assignments"
          value={members}
        />
      </section>

      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">Space directory</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Open a space to manage its pages, members and access rules.
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
              {spaces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <FolderKanban className="text-muted-foreground mx-auto size-7" />
                    <p className="mt-3 font-medium">No spaces yet</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Create a space from the workspace menu to start organizing
                      knowledge.
                    </p>
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

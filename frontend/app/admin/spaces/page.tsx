import { Archive, FolderKanban, Globe2, LockKeyhole, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ListFilters, PaginationControls } from "@/components/admin/list-controls";
import { SpaceRowActions } from "@/components/admin/space-row-actions";
import { Badge } from "@/components/ui/badge";
import { listSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50, 100] as const;

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof FolderKanban; label: string; value: number }) {
  return <div className="min-w-0 px-4 py-3 first:pl-4 sm:border-r sm:last:border-r-0"><div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5" />{label}</div><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p></div>;
}

export default async function AdminSpacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : (params.q ?? "");
  const rawLimit = Array.isArray(params.limit) ? params.limit[0] : params.limit;
  const rawOffset = Array.isArray(params.offset) ? params.offset[0] : params.offset;
  const requestedLimit = Number.parseInt(rawLimit || String(PAGE_SIZE), 10);
  const limit = PAGE_SIZES.includes(requestedLimit as 10 | 25 | 50 | 100)
    ? requestedLimit
    : PAGE_SIZE;
  const offset = Number.parseInt(rawOffset || "0", 10) || 0;
  const spaces = await listSpaces(true, 200);
  const active = spaces.filter((space) => space.status === "active").length;
  const archived = spaces.length - active;
  const members = spaces.reduce((total, space) => total + space.member_count, 0);
  const query = rawQuery.trim().toLowerCase();
  const filteredSpaces = spaces.filter((space) => !query || (space.name + " " + space.key + " " + space.description).toLowerCase().includes(query));
  const pageSpaces = filteredSpaces.slice(offset, offset + limit);

  return <div className="space-y-5">
    <header className="border-border border-b pb-5">
      <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">Administration</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">Spaces</h2>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm">Review documentation spaces, membership and workspace visibility. Permanent deletion is available only here.</p>
    </header>

    <section aria-label="Space summary" className="border-border bg-surface grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
      <SummaryMetric icon={FolderKanban} label="Total spaces" value={spaces.length} />
      <SummaryMetric icon={FolderKanban} label="Active" value={active} />
      <SummaryMetric icon={Archive} label="Archived" value={archived} />
      <SummaryMetric icon={Users} label="Member assignments" value={members} />
    </section>

    <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3"><div><h3 className="font-medium">Space directory</h3><p className="text-muted-foreground mt-0.5 text-xs">Open a space to manage its pages, members and access rules.</p></div><Suspense fallback={null}><ListFilters searchValue={rawQuery} searchPlaceholder="Search spaces" /></Suspense></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-border bg-surface-sunken text-muted-foreground border-b text-left"><th className="w-[43%] px-4 py-3 font-medium">Space</th><th className="w-[17%] px-4 py-3 font-medium">Visibility</th><th className="w-[14%] px-4 py-3 font-medium">Members</th><th className="w-[14%] px-4 py-3 font-medium">Status</th><th className="w-[12%] px-4 py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>{spaces.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center"><FolderKanban className="text-muted-foreground mx-auto size-7" /><p className="mt-3 font-medium">No spaces yet</p><p className="text-muted-foreground mt-1 text-sm">Create a space from the workspace menu to start organizing knowledge.</p></td></tr> : filteredSpaces.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center"><p className="font-medium">No spaces found</p><p className="text-muted-foreground mt-1 text-sm">Try a different name or space key.</p></td></tr> : pageSpaces.map((space) => <tr key={space.id} className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
            <td className="px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md text-base">{space.icon || "◆"}</span><div className="min-w-0"><Link className="block truncate font-medium text-primary hover:text-primary-hover hover:underline" href={"/admin/spaces/" + encodeURIComponent(space.key)}>{space.name}</Link><p className="text-muted-foreground mt-0.5 truncate text-xs">{space.description || space.key}</p></div></div></td>
            <td className="px-4 py-3"><span className="flex items-center gap-2">{space.visibility === "open" ? <Globe2 className="text-muted-foreground size-3.5" /> : <LockKeyhole className="text-muted-foreground size-3.5" />}<span>{space.visibility === "open" ? "Public" : "Private"}</span></span></td>
            <td className="text-muted-foreground px-4 py-3">{space.member_count} member{space.member_count === 1 ? "" : "s"}</td>
            <td className="px-4 py-3"><Badge variant={space.status === "active" ? "success" : "warning"}>{space.status === "active" ? "Active" : "Archived"}</Badge></td>
            <td className="px-4 py-3"><SpaceRowActions space={space} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      {filteredSpaces.length > 0 ? <div className="border-border bg-surface-sunken border-t px-4 py-3"><Suspense fallback={null}><PaginationControls total={filteredSpaces.length} limit={limit} offset={offset} pageSizes={[...PAGE_SIZES]} /></Suspense></div> : null}
    </section>
  </div>;
}

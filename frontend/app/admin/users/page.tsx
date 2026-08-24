import { ShieldCheck, UserCheck, UserRound, UserX, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { ListFilters, PaginationControls } from "@/components/admin/list-controls";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { Badge } from "@/components/ui/badge";
import { listUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

// Keep the directory scannable and make pagination useful before the user
// list becomes unwieldy.
const PAGE_SIZE = 10;
const USER_PAGE_SIZES = [10, 25, 50, 100] as const;
const COLUMN_WIDTHS = ["26%", "20%", "24%", "10%", "10%", "10%"];

function ColumnWidths() {
  return <colgroup>{COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <div className="min-w-0 px-4 py-3 sm:border-r sm:last:border-r-0">
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5 shrink-0" />{label}</div>
    <p className="mt-1 text-lg font-semibold tracking-tight">{new Intl.NumberFormat("en-US").format(value)}</p>
  </div>;
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };
  const q = single("q");
  const status = single("status");
  const role = single("role");
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;
  const requestedLimit = Number.parseInt(single("limit") || String(PAGE_SIZE), 10);
  const limit = USER_PAGE_SIZES.includes(requestedLimit as 10 | 25 | 50 | 100)
    ? requestedLimit
    : PAGE_SIZE;
  const [me, page, totalStat, adminStat, activeStat, disabledStat] = await Promise.all([
    getCurrentUser(),
    listUsers({ q, status, role, limit, offset }),
    listUsers({ limit: 1 }),
    listUsers({ role: "admin", limit: 1 }),
    listUsers({ status: "active", limit: 1 }),
    listUsers({ status: "disabled", limit: 1 }),
  ]);
  const totalUsers = totalStat.total;
  const adminCount = adminStat.total;

  return <div className="space-y-5">
    <header className="border-border flex shrink-0 flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div><p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">Administration</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Users</h2><p className="text-muted-foreground mt-1 max-w-2xl text-sm">Manage workspace accounts, their roles and sign-in access.</p></div>
      <CreateUserDialog />
    </header>

    <section aria-label="User account summary" className="border-border bg-surface grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3 lg:grid-cols-5">
      <SummaryMetric icon={Users} label="Total users" value={totalUsers} />
      <SummaryMetric icon={ShieldCheck} label="Administrators" value={adminCount} />
      <SummaryMetric icon={UserRound} label="Members" value={totalUsers - adminCount} />
      <SummaryMetric icon={UserCheck} label="Active" value={activeStat.total} />
      <SummaryMetric icon={UserX} label="Disabled" value={disabledStat.total} />
    </section>

    <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
      <div className="border-border flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div><h3 className="font-medium">People directory</h3><p className="text-muted-foreground mt-0.5 text-xs">Review accounts and manage access to this workspace.</p></div>
        <Suspense fallback={null}><ListFilters searchValue={q} searchPlaceholder="Search users" filters={[
          { name: "status", label: "Status", value: status, options: [{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }] },
          { name: "role", label: "Role", value: role, options: [{ value: "admin", label: "Administrator" }, { value: "member", label: "Member" }] },
        ]} /></Suspense>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-sm"><ColumnWidths /><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-4 py-3 font-medium">User</th><th className="px-4 py-3 font-medium">E-mail</th><th className="px-4 py-3 font-medium">Groups</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr></thead><tbody>{page.items.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center"><UserRound className="text-muted-foreground mx-auto size-7" /><p className="mt-3 font-medium">No users found</p><p className="text-muted-foreground mt-1 text-sm">Try changing the search or filters.</p></td></tr> : page.items.map((user) => <tr key={user.id} className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
          <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{initials(user.full_name || user.username)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="truncate font-medium">{user.full_name || user.username}</span>{me?.id === user.id ? <Badge variant="info">you</Badge> : null}{user.is_protected ? <Badge title="Built-in account: it cannot be modified, deactivated or deleted.">protected</Badge> : null}</div><p className="text-muted-foreground truncate text-xs">@{user.username}</p></div></div></td>
          <td className="text-muted-foreground truncate px-4 py-3" title={user.email}>{user.email}</td>
          <td className="px-4 py-3">{user.groups.length ? <div className="flex flex-wrap gap-1">{user.groups.map((group) => <Badge key={group} variant="neutral" title={group} className="max-w-full truncate">{group}</Badge>)}</div> : <span className="text-muted-foreground">—</span>}</td>
          <td className="px-4 py-3"><Badge variant={user.is_superuser ? "info" : "neutral"}>{user.is_superuser ? "Admin" : "Member"}</Badge></td>
          <td className="px-4 py-3"><Badge variant={user.is_active ? "success" : "warning"}>{user.is_active ? "Active" : "Disabled"}</Badge></td>
          <td className="px-4 py-3"><UserRowActions user={user} isSelf={me?.id === user.id} /></td>
        </tr>)}</tbody></table>
      </div>
      <div className="border-border bg-surface-sunken shrink-0 border-t px-4 py-3"><Suspense fallback={null}><PaginationControls total={page.total} limit={page.limit} offset={page.offset} pageSizes={[...USER_PAGE_SIZES]} /></Suspense></div>
    </section>
  </div>;
}

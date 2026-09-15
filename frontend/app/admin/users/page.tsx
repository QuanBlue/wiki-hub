import { KeyRound, ShieldCheck, UserCheck, UserRound, UserX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdministratorsSummary, AdministratorsTable } from "@/components/admin/administrators-table";
import { BulkDeleteBar, BulkSelectionProvider, SelectionCell, SelectionColumn, SelectionHeaderCell, SelectModeButton } from "@/components/admin/bulk-select";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { ListFilters, PaginationControls } from "@/components/admin/list-controls";
import { PermissionOverridesSummary, PermissionOverridesTable } from "@/components/admin/permission-overrides-table";
import { SummaryMetrics } from "@/components/admin/summary-metrics";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { listAdministrators, listPermissionOverrideUsers, listUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

// Keep the directory scannable and make pagination useful before the user
// list becomes unwieldy.
const PAGE_SIZE = 10;
const USER_PAGE_SIZES = [10, 25, 50, 100] as const;
const COLUMN_WIDTHS = ["26%", "20%", "24%", "10%", "10%", "10%"];

function ColumnWidths() {
  return (
    <colgroup>
      <SelectionColumn />
      {COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}
    </colgroup>
  );
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}


function TabLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof Users;
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

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };
  const rawTab = single("tab");
  const tab =
    rawTab === "administrators"
      ? "administrators"
      : rawTab === "overrides"
        ? "overrides"
        : "people";
  const q = single("q");
  const status = single("status");
  const role = single("role");
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;
  const requestedLimit = Number.parseInt(single("limit") || String(PAGE_SIZE), 10);
  const limit = USER_PAGE_SIZES.includes(requestedLimit as 10 | 25 | 50 | 100)
    ? requestedLimit
    : PAGE_SIZE;

  const [me, { t, locale }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // The layout only checks for *some* admin permission (see its own
  // comment) - `manage_groups` alone gets someone past it but grants
  // nothing here, so this page needs its own, narrower check before firing
  // off requests the backend would 403 anyway (`list_users`/
  // `list_administrators` both require `manage_users` - see
  // `app/api/v1/users.py`).
  const canManageUsers =
    me?.is_superuser ||
    me?.global_permissions.includes("system_admin") ||
    me?.global_permissions.includes("manage_users");

  if (!canManageUsers) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">{t("adminShared.permissionRequiredTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminUsers.permissionFeature"),
            permission: t("adminShared.manageUsersLabel"),
          })}
        </p>
      </div>
    );
  }

  const [page, totalStat, adminStat, activeStat, disabledStat, admins, overrideUsers] =
    await Promise.all([
      listUsers({ q, status, role, limit, offset }),
      listUsers({ limit: 1 }),
      listUsers({ role: "admin", limit: 1 }),
      listUsers({ status: "active", limit: 1 }),
      listUsers({ status: "disabled", limit: 1 }),
      listAdministrators(),
      listPermissionOverrideUsers(),
    ]);
  const totalUsers = totalStat.total;
  const adminCount = adminStat.total;
  const viewerIsSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");
  // Mirrors `AuthService.assert_peer_admin_editable` on the backend: only
  // the protected bootstrap administrator may touch another Administrator's
  // account - a `manage_users` grant alone (from a group or an override)
  // never reaches that far, the same way it can never grant or revoke the
  // Administrator role itself (see `AuthService.assert_actor_is_system_admin`).
  function peerAdminBlocked(user: { is_superuser: boolean; id: string }): boolean {
    return user.is_superuser && me?.id !== user.id && !me?.is_protected;
  }
  // Same eligibility every row's own `SelectionCell` already enforces
  // (protected/self/peer-admin can't be bulk-selected) - "select all" must
  // match it exactly, or it would try to select rows whose checkbox doesn't
  // exist.
  const selectableUserIds = page.items
    .filter((user) => !user.is_protected && me?.id !== user.id && !peerAdminBlocked(user))
    .map((user) => user.id);

  return <div className="space-y-5">
    <header className="border-border flex shrink-0 flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div><p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">{t("nav.administration")}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">{t("adminUsers.title")}</h2><p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t("adminUsers.description")}</p></div>
    </header>

    <SummaryMetrics
      label={t("adminUsers.summaryLabel")}
      locale={locale}
      items={[
        { icon: Users, label: t("adminUsers.totalUsers"), value: totalUsers, tone: "primary" },
        { icon: ShieldCheck, label: t("adminUsers.administrators"), value: adminCount },
        { icon: UserRound, label: t("adminUsers.members"), value: totalUsers - adminCount },
        { icon: UserCheck, label: t("adminUsers.active"), value: activeStat.total, tone: "success" },
        { icon: UserX, label: t("adminUsers.disabled"), value: disabledStat.total, tone: "warning" },
      ]}
    />

    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav
        className="border-border bg-surface-sunken flex w-fit shrink-0 items-center rounded-md border p-0.5"
        aria-label={t("adminUsers.sectionsAria")}
      >
        <TabLink href="?tab=people" active={tab === "people"} icon={UserRound}>
          {t("adminUsers.peopleDirectoryTab", { count: totalUsers })}
        </TabLink>
        <TabLink href="?tab=administrators" active={tab === "administrators"} icon={ShieldCheck}>
          {t("adminUsers.administratorsTab", { count: admins.length })}
        </TabLink>
        <TabLink href="?tab=overrides" active={tab === "overrides"} icon={KeyRound}>
          {t("adminUsers.permissionOverridesTab", { count: overrideUsers.length })}
        </TabLink>
      </nav>
      <CreateUserDialog viewerIsSystemAdmin={!!viewerIsSystemAdmin} />
    </div>

    {tab === "administrators" ? (
      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">{t("adminUsers.administratorsHeading")}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("adminUsers.administratorsHint")}
            </p>
          </div>
          <AdministratorsSummary count={admins.length} />
        </div>
        <AdministratorsTable admins={admins} meId={me?.id} viewerIsProtected={me?.is_protected ?? false} />
      </section>
    ) : tab === "overrides" ? (
      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">{t("adminUsers.permissionOverridesHeading")}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("adminUsers.permissionOverridesHint")}
            </p>
          </div>
          <PermissionOverridesSummary count={overrideUsers.length} />
        </div>
        <PermissionOverridesTable
          users={overrideUsers}
          meId={me?.id}
          viewerIsProtected={me?.is_protected ?? false}
          viewerIsSystemAdmin={!!viewerIsSystemAdmin}
        />
      </section>
    ) : (
      <BulkSelectionProvider>
        <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
          <div className="border-border flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
            <div><h3 className="font-medium">{t("adminUsers.peopleDirectoryHeading")}</h3><p className="text-muted-foreground mt-0.5 text-xs">{t("adminUsers.peopleDirectoryHint")}</p></div>
            <div className="flex flex-wrap items-end gap-2">
              <Suspense fallback={null}><ListFilters searchValue={q} searchPlaceholder={t("adminUsers.searchPlaceholder")} filters={[
                { name: "status", label: t("adminUsers.statusLabel"), value: status, options: [{ value: "active", label: t("adminUsers.active") }, { value: "disabled", label: t("adminUsers.disabled") }] },
                { name: "role", label: t("adminUsers.roleLabel"), value: role, options: [{ value: "admin", label: t("adminUsers.roleAdministrator") }, { value: "member", label: t("adminUsers.roleMember") }] },
              ]} /></Suspense>
              <SelectModeButton />
            </div>
          </div>
          <BulkDeleteBar
            deleteEndpointBase="/api/v1/users"
            itemNoun="user"
            confirmNote={t("adminUsers.bulkDeleteNote")}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] table-fixed text-sm"><ColumnWidths /><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><SelectionHeaderCell ids={selectableUserIds} /><th className="px-4 py-3 font-medium">{t("adminUsers.columnUser")}</th><th className="px-4 py-3 font-medium">{t("adminUsers.columnEmail")}</th><th className="px-4 py-3 font-medium">{t("adminUsers.columnGroups")}</th><th className="px-4 py-3 font-medium">{t("adminUsers.columnRole")}</th><th className="px-4 py-3 font-medium">{t("adminUsers.columnStatus")}</th><th className="px-4 py-3 text-right font-medium">{t("adminUsers.columnActions")}</th></tr></thead><tbody>{page.items.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center"><UserRound className="text-muted-foreground mx-auto size-7" /><p className="mt-3 font-medium">{t("adminUsers.noUsersFound")}</p><p className="text-muted-foreground mt-1 text-sm">{t("adminUsers.tryChangingFilters")}</p></td></tr> : page.items.map((user) => <tr key={user.id} className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
              <SelectionCell
                id={user.id}
                disabled={user.is_protected || me?.id === user.id || peerAdminBlocked(user)}
                title={user.is_protected ? t("adminUsers.protectedAccountTitle") : me?.id === user.id ? t("adminUsers.thisIsYou") : peerAdminBlocked(user) ? t("adminUsers.onlyBuiltinCanAct") : undefined}
              />
              <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{initials(user.full_name || user.username)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><UserProfileTrigger username={user.username} fullName={user.full_name} className="truncate font-medium" />{me?.id === user.id ? <Badge variant="info">{t("adminUsers.youBadge")}</Badge> : null}{user.is_protected ? <Badge title={t("adminUsers.protectedBadgeTitle")}>{t("adminUsers.protectedBadge")}</Badge> : null}</div><p className="text-muted-foreground truncate text-xs">@{user.username}</p></div></div></td>
              <td className="text-muted-foreground truncate px-4 py-3" title={user.email}>{user.email}</td>
              <td className="px-4 py-3">{user.groups.length ? <div className="flex flex-wrap gap-1">{user.groups.map((group) => <Badge key={group} variant="neutral" title={group} className="max-w-full truncate">{group}</Badge>)}</div> : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-4 py-3"><Badge variant={user.is_superuser || user.is_effective_admin ? "info" : "neutral"} title={!user.is_superuser && user.is_effective_admin ? t("adminUsers.notSetDirectlyTitle") : undefined}>{user.is_superuser || user.is_effective_admin ? t("adminUsers.adminBadge") : t("adminUsers.roleMember")}</Badge></td>
              <td className="px-4 py-3"><Badge variant={user.is_active ? "success" : "warning"}>{user.is_active ? t("adminUsers.active") : t("adminUsers.disabled")}</Badge></td>
              <td className="px-4 py-3"><UserRowActions user={user} isSelf={me?.id === user.id} viewerIsProtected={me?.is_protected ?? false} viewerIsSystemAdmin={!!viewerIsSystemAdmin} /></td>
            </tr>)}</tbody></table>
          </div>
          <div className="border-border bg-surface-sunken shrink-0 border-t px-4 py-3"><Suspense fallback={null}><PaginationControls total={page.total} limit={page.limit} offset={page.offset} pageSizes={[...USER_PAGE_SIZES]} /></Suspense></div>
        </section>
      </BulkSelectionProvider>
    )}
  </div>;
}

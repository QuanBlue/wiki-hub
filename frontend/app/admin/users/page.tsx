import { ShieldCheck, UserCheck, UserRound as UserRoundIcon, UserX, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import {
  ListFilters,
  PaginationControls,
} from "@/components/admin/list-controls";
import { StatTile } from "@/components/admin/stat-tile";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { Badge } from "@/components/ui/badge";
import { listUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

// Shared between the (non-scrolling) header table and the (scrolling) body
// table below, via <colgroup>, so their columns stay pixel-aligned even
// though they are two separate <table> elements.
const COLUMN_WIDTHS = ["26%", "24%", "16%", "12%", "10%", "12%"];

function ColumnWidths() {
  return (
    <colgroup>
      {COLUMN_WIDTHS.map((width, index) => (
        // A fixed, never-reordered set of columns - the index is a stable key.
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };

  const q = single("q");
  const status = single("status");
  const role = single("role");
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;

  // The layout already guaranteed a superuser; this is for the self-guards.
  // The stat tiles are workspace-wide counts, independent of the table's own
  // filters - `limit: 1` keeps each of those requests to a single row; only
  // `.total` is read from them.
  const [me, page, totalStat, adminStat, activeStat, disabledStat] =
    await Promise.all([
      getCurrentUser(),
      listUsers({ q, status, role, limit: PAGE_SIZE, offset }),
      listUsers({ limit: 1 }),
      listUsers({ role: "admin", limit: 1 }),
      listUsers({ status: "active", limit: 1 }),
      listUsers({ status: "disabled", limit: 1 }),
    ]);
  const totalUsers = totalStat.total;
  const adminCount = adminStat.total;

  return (
    // Fixed to the viewport below the top bar (matches the height budget the
    // home page's activity feed already uses) so the stat tiles, filters and
    // pagination stay put and only the table body scrolls - a 25-row page no
    // longer scrolls the whole admin shell to reach "Next".
    <div className="flex h-[calc(100dvh-var(--wh-topbar-height)-5rem)] flex-col gap-5">
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile icon={Users} label="Total users" value={totalUsers} />
        <StatTile icon={ShieldCheck} label="Administrators" value={adminCount} />
        <StatTile
          icon={UserRoundIcon}
          label="Members"
          value={totalUsers - adminCount}
        />
        <StatTile icon={UserCheck} label="Active" value={activeStat.total} />
        <StatTile icon={UserX} label="Disabled" value={disabledStat.total} />
      </div>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <Suspense fallback={null}>
          <ListFilters
            searchValue={q}
            searchPlaceholder="Search users…"
            filters={[
              {
                name: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "active", label: "Active" },
                  { value: "disabled", label: "Disabled" },
                ],
              },
              {
                name: "role",
                label: "Role",
                value: role,
                options: [
                  { value: "admin", label: "Administrator" },
                  { value: "member", label: "Member" },
                ],
              },
            ]}
          />
        </Suspense>
        <CreateUserDialog />
      </div>

      {/*
        A sticky <thead> inside the scrolling element was still wrong: a
        native scrollbar spans the *whole* scroll viewport, so its track (and
        thumb, at the top of the scroll) always runs right alongside the
        header, no matter how it's clipped or styled. The only way to keep
        the scrollbar out of the header entirely is to take the header out of
        the scrolling element - a separate, non-scrolling table above the
        scrollable body table, their columns kept aligned via the same
        <colgroup> widths.
      */}
      <div className="border-border bg-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm">
        <table className="w-full table-fixed text-sm">
          <ColumnWidths />
          <thead>
            <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Groups</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
        </table>

        {/* wh-scroll: the app's thin, arrow-button-free scrollbar (see
            globals.css). `scrollbarGutter: stable` always reserves its track
            width, scrolling or not, so the body's columns don't shift a few
            pixels narrower than the header's the moment a page grows past
            one screenful. */}
        <div
          className="wh-scroll min-h-0 flex-1 overflow-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          {/* table-fixed + explicit column widths so a long e-mail (imported
              accounts get one like `<id>@imported.confluence`) truncates
              instead of stretching the table past its container. */}
          <table className="w-full table-fixed text-sm">
            <ColumnWidths />
            <tbody>
              {page.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-muted-foreground px-4 py-8 text-center"
                  >
                    No users match these filters.
                  </td>
                </tr>
              ) : (
                page.items.map((user) => (
                  <tr
                    key={user.id}
                    className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        >
                          {initials(user.full_name || user.username)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">
                              {user.full_name || user.username}
                            </span>
                            {me?.id === user.id ? (
                              <Badge variant="info">you</Badge>
                            ) : null}
                            {user.is_protected ? (
                              <Badge title="Built-in account: it cannot be modified, deactivated or deleted, so there is always a way back in.">
                                protected
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">
                            @{user.username}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td
                      className="text-muted-foreground truncate px-4 py-3"
                      title={user.email}
                    >
                      {user.email}
                    </td>
                    <td className="px-4 py-3">
                      {user.groups.length > 0 ? (
                        <div className="flex flex-wrap gap-1 overflow-hidden">
                          {user.groups.map((group) => (
                            <Badge key={group} variant="neutral" className="truncate">
                              {group}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="truncate px-4 py-3">
                      {user.is_superuser ? "Administrator" : "Member"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.is_active ? "success" : "warning"}>
                        {user.is_active ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <UserRowActions user={user} isSelf={me?.id === user.id} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="shrink-0">
        <Suspense fallback={null}>
          <PaginationControls
            total={page.total}
            limit={page.limit}
            offset={page.offset}
          />
        </Suspense>
      </div>
    </div>
  );
}

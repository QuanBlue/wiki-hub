import type { Metadata } from "next";
import { Suspense } from "react";

import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import {
  ListFilters,
  PaginationControls,
} from "@/components/admin/list-controls";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { Badge } from "@/components/ui/badge";
import { listUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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
  const [me, page] = await Promise.all([
    getCurrentUser(),
    listUsers({ q, status, role, limit: PAGE_SIZE, offset }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">People</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Control who can access and help maintain your team&apos;s knowledge.
        </p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
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

      <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
        <table className="w-full text-sm">
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
                    {user.full_name || user.username}{" "}
                    <span className="text-muted-foreground">
                      @{user.username}
                    </span>
                    {me?.id === user.id ? (
                      <Badge variant="info" className="ml-2">
                        you
                      </Badge>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    {user.groups.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.groups.map((group) => (
                          <Badge key={group} variant="neutral">
                            {group}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.is_superuser ? "Administrator" : "Member"}
                    {user.is_protected ? (
                      <Badge
                        className="ml-2"
                        title="Built-in account: it cannot be modified, deactivated or deleted, so there is always a way back in."
                      >
                        protected
                      </Badge>
                    ) : null}
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

      <Suspense fallback={null}>
        <PaginationControls
          total={page.total}
          limit={page.limit}
          offset={page.offset}
        />
      </Suspense>
    </div>
  );
}

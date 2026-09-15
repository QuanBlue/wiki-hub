"use client";

import { KeyRound } from "lucide-react";

import { UserRowActions } from "@/components/admin/user-row-actions";
import { Badge } from "@/components/ui/badge";
import type { GlobalPermission, User } from "@/types/api";

const PERMISSION_LABEL: Record<GlobalPermission, string> = {
  create_space: "Create spaces",
  manage_users: "Manage users",
  manage_groups: "Manage groups",
  system_admin: "System administrator",
};

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

/**
 * Every account with at least one Global Access override - previously the
 * only way to see this was opening each account's Edit dialog one at a
 * time and checking its Global Access tab, i.e. guessing who to check.
 * `global_permission_overrides` is always populated here (the backend's
 * `/users/permission-overrides` runs a full per-account read only for this,
 * typically small, matching subset), unlike the People directory's own row
 * data, which never carries it (see `_read_user`'s docstring on the
 * backend).
 */
export function PermissionOverridesTable({
  users,
  meId,
  viewerIsProtected,
  viewerIsSystemAdmin,
}: {
  users: User[];
  meId: string | undefined;
  viewerIsProtected: boolean;
  viewerIsSystemAdmin: boolean;
}) {
  if (users.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <KeyRound className="text-muted-foreground mx-auto size-7" />
        <p className="mt-3 font-medium">No permission overrides</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Every account&apos;s global access currently just inherits from its
          Role or groups - nobody has a per-user override.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
            <th className="w-[24%] px-4 py-3 font-medium">User</th>
            <th className="w-[20%] px-4 py-3 font-medium">E-mail</th>
            <th className="px-4 py-3 font-medium">Overrides</th>
            <th className="w-[14%] px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((account) => {
            const isSelf = account.id === meId;
            return (
              <tr
                key={account.id}
                className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {initials(account.full_name || account.username)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-medium">
                          {account.full_name || account.username}
                        </p>
                        {isSelf ? <Badge variant="info">you</Badge> : null}
                        {account.is_protected ? (
                          <Badge title="Built-in account: it cannot be modified, deactivated or deleted.">
                            protected
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground truncate text-xs">
                        @{account.username}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="text-muted-foreground truncate px-4 py-3" title={account.email}>
                  {account.email}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {account.global_permission_overrides.map((override) => (
                      <Badge
                        key={override.permission}
                        variant={override.enabled ? "success" : "neutral"}
                        title={`${PERMISSION_LABEL[override.permission]}: force-${
                          override.enabled ? "enabled" : "disabled"
                        } for this account specifically, regardless of its groups.`}
                      >
                        {PERMISSION_LABEL[override.permission]}:{" "}
                        {override.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <UserRowActions
                    user={account}
                    isSelf={isSelf}
                    viewerIsProtected={viewerIsProtected}
                    viewerIsSystemAdmin={viewerIsSystemAdmin}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PermissionOverridesSummary({ count }: { count: number }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <KeyRound className="size-3.5" />
      {count} account{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"} at
      least one Global Access override.
    </p>
  );
}

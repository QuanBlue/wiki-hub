"use client";

import { ShieldCheck, Trash2, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Group } from "@/types/api";

const PERMISSION_LABEL: Record<string, string> = {
  create_space: "Create spaces",
  manage_users: "Manage users",
  manage_groups: "Manage groups",
  system_admin: "System admin",
};

const DEFAULT_GROUP_NAMES = new Set([
  "confluence-administrators",
  "confluence-users",
  "administrators",
  "users",
]);

function isDefaultGroup(group: Group): boolean {
  return DEFAULT_GROUP_NAMES.has(group.name.toLowerCase().trim());
}

/**
 * Every group that currently grants at least one Global permission - the
 * few groups worth double-checking before handing out group membership,
 * out of what is usually a much longer list of groups that exist purely
 * for Space/Page access and carry no workspace-wide power at all. Reuses
 * the Directory's own `global_permissions` (already present on every
 * `Group` row - unlike a user's per-account overrides, a group's grants are
 * not a separate, un-populated field), so this needs no extra request.
 */
export function GroupGlobalAccessTable({
  groups,
  onEdit,
  onDelete,
}: {
  groups: Group[];
  onEdit: (group: Group) => void;
  onDelete: (group: Group) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <ShieldCheck className="text-muted-foreground mx-auto size-7" />
        <p className="mt-3 font-medium">No groups grant global access</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Every group in this workspace is currently scoped to Space/Page
          access only - none of them carry Create spaces, Manage users,
          Manage groups, or System admin.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
            <th className="w-[28%] px-4 py-3 font-medium">Group</th>
            <th className="w-[18%] px-4 py-3 font-medium">Owner</th>
            <th className="w-[12%] px-4 py-3 font-medium">Members</th>
            <th className="px-4 py-3 font-medium">Global access</th>
            <th className="w-[14%] px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isDefault = isDefaultGroup(group);
            return (
              <tr
                key={group.id}
                className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
                      <UsersRound className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{group.name}</p>
                        {isDefault ? (
                          <Badge variant="neutral" className="text-[10px] font-semibold uppercase">
                            Default
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {group.description || "No description"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-muted-foreground truncate">
                    {group.owner_username ? `@${group.owner_username}` : "—"}
                  </p>
                </td>
                <td className="text-muted-foreground px-4 py-3">
                  {group.member_count} member{group.member_count === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {group.global_permissions.map((permission) => (
                      <Badge key={permission} variant="info">
                        {PERMISSION_LABEL[permission] ?? permission}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEdit(group)}
                      aria-label={"Edit " + group.name}
                      className="hover:bg-surface-selected!"
                    >
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onDelete(group)}
                      disabled={isDefault}
                      title={
                        isDefault
                          ? "Default system group cannot be deleted"
                          : "Delete " + group.name
                      }
                      aria-label={"Delete " + group.name}
                      className={cn(
                        "hover:bg-danger-bg! hover:text-danger!",
                        isDefault &&
                          "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
                      )}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GroupGlobalAccessSummary({ count }: { count: number }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <ShieldCheck className="size-3.5" />
      {count} group{count === 1 ? "" : "s"} currently grant{count === 1 ? "s" : ""} at
      least one Global permission.
    </p>
  );
}

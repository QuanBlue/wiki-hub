"use client";

import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateGroupDialog } from "@/components/admin/create-group-dialog";
import { EditGroupDialog } from "@/components/admin/edit-group-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Group, User } from "@/types/api";

const PERMISSIONS = [
  ["create_space", "Create spaces"],
  ["manage_users", "Manage users"],
  ["manage_groups", "Manage groups"],
  ["system_admin", "System admin"],
] as const;

const DEFAULT_GROUP_NAMES = new Set([
  "confluence-administrators",
  "confluence-users",
  "administrators",
  "users",
]);

function isDefaultGroup(group: Group): boolean {
  return DEFAULT_GROUP_NAMES.has(group.name.toLowerCase().trim());
}

export function GroupManager({
  initialGroups,
  users,
}: {
  initialGroups: Group[];
  users: User[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const needle = query.trim().toLowerCase();
  const filtered = groups.filter(
    (group) =>
      !needle ||
      (
        group.name +
        " " +
        group.description +
        " " +
        (group.owner_username ?? "")
      )
        .toLowerCase()
        .includes(needle),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const pageGroups = filtered.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );
  const totalMembers = groups.reduce(
    (total, group) => total + group.member_count,
    0,
  );

  async function removeGroup(group: Group) {
    if (isDefaultGroup(group)) {
      toast.error("Default system groups cannot be deleted.");
      setDeleteTarget(null);
      return;
    }
    setDeletePending(true);
    try {
      await api.delete("/api/v1/groups/" + group.id);
      setGroups((current) => current.filter((item) => item.id !== group.id));
      toast.success("Group deleted.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not delete group.",
      );
    } finally {
      setDeletePending(false);
      setDeleteTarget(null);
    }
  }

  function handleGroupUpdated(updated: Group) {
    setGroups((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    if (editingGroup?.id === updated.id) {
      setEditingGroup(updated);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5 text-sm">
          <span className="flex items-center gap-2">
            <UsersRound className="text-muted-foreground size-4" />
            <strong>{groups.length}</strong>
            <span className="text-muted-foreground">groups</span>
          </span>
          <span className="text-muted-foreground">
            {totalMembers} member{totalMembers === 1 ? "" : "s"} assigned
          </span>
        </div>
        <CreateGroupDialog
          users={users}
          onCreated={(group) =>
            setGroups((current) =>
              [...current, group].sort((left, right) =>
                left.name.localeCompare(right.name),
              ),
            )
          }
        />
      </div>

      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">Directory</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Manage workspace teams, member assignments, and global access.
            </p>
          </div>
          <form
            className="flex w-full items-end gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
            }}
          >
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search groups"
                aria-label="Search groups"
                className="w-56 pr-8 pl-8"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                  className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  aria-label="Clear group search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </div>
        {groups.length === 0 ? (
          <EmptyGroups
            users={users}
            onCreated={(group) =>
              setGroups((current) =>
                [...current, group].sort((left, right) =>
                  left.name.localeCompare(right.name),
                ),
              )
            }
          />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Search className="text-muted-foreground mx-auto size-6" />
            <p className="mt-3 font-medium">No groups found</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuery("");
                setPage(0);
              }}
            >
              Clear search
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                    <th className="w-[31%] px-4 py-3 font-medium">Group</th>
                    <th className="w-[18%] px-4 py-3 font-medium">Owner</th>
                    <th className="w-[12%] px-4 py-3 font-medium">Members</th>
                    <th className="w-[25%] px-4 py-3 font-medium">
                      Global access
                    </th>
                    <th className="w-[14%] px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((group) => (
                    <GroupRow
                      key={group.id}
                      group={group}
                      users={users}
                      onEdit={() => setEditingGroup(group)}
                      onDelete={() => setDeleteTarget(group)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-border bg-surface-sunken flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-muted-foreground text-sm">
                Showing {activePage * pageSize + 1}–
                {Math.min((activePage + 1) * pageSize, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPage(0);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-20"
                    aria-label="Rows per page"
                  >
                    <SelectValue>{pageSize}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground hidden text-xs sm:inline">
                  Page {activePage + 1} of {pageCount}
                </span>
                <Button
                  size="icon"
                  variant="secondary"
                  disabled={activePage === 0}
                  onClick={() => setPage(activePage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  disabled={activePage + 1 >= pageCount}
                  onClick={() => setPage(activePage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <EditGroupDialog
        group={editingGroup}
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null);
        }}
        users={users}
        onGroupUpdated={handleGroupUpdated}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteTarget(null);
        }}
        title="Delete group?"
        description={
          deleteTarget
            ? 'This removes the group "' +
              deleteTarget.name +
              '". Existing space permissions must be removed first.'
            : ""
        }
        confirmLabel="Delete group"
        destructive
        pending={deletePending}
        onConfirm={() => {
          if (deleteTarget) void removeGroup(deleteTarget);
        }}
      />
    </div>
  );
}

function EmptyGroups({
  users,
  onCreated,
}: {
  users: User[];
  onCreated: (group: Group) => void;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <UsersRound className="text-muted-foreground mx-auto size-7" />
      <p className="mt-3 font-medium">No groups yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create a group to manage a team&apos;s access together.
      </p>
      <div className="mt-4">
        <CreateGroupDialog users={users} onCreated={onCreated} />
      </div>
    </div>
  );
}

function GroupRow({
  group,
  users,
  onEdit,
  onDelete,
}: {
  group: Group;
  users: User[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const owner = users.find((user) => user.id === group.owner_id);
  const isDefault = isDefaultGroup(group);

  return (
    <tr className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
            <UsersRound className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{group.name}</p>
              {isDefault ? (
                <Badge variant="neutral" className="text-[10px] uppercase font-semibold">
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
        <p className="truncate">
          {owner?.full_name || group.owner_username || "—"}
        </p>
        {group.owner_username ? (
          <p className="text-muted-foreground truncate text-xs">
            @{group.owner_username}
          </p>
        ) : null}
      </td>
      <td className="text-muted-foreground px-4 py-3">
        {group.member_count} member{group.member_count === 1 ? "" : "s"}
      </td>
      <td className="px-4 py-3">
        {group.global_permissions.length ? (
          <div className="flex flex-wrap gap-1">
            {group.global_permissions.map((permission) => (
              <Badge key={permission} variant="info">
                {PERMISSIONS.find(([key]) => key === permission)?.[1] ??
                  permission}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">No global access</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            aria-label={"Edit " + group.name}
          >
            <Pencil />
            Edit
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={isDefault}
            title={
              isDefault
                ? "Default system group cannot be deleted"
                : "Delete " + group.name
            }
            aria-label={"Delete " + group.name}
            className={cn(
              "hover:bg-danger-bg hover:text-danger",
              isDefault && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit"
            )}
          >
            <Trash2 />
          </Button>
        </div>
      </td>
    </tr>
  );
}

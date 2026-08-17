"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateGroupDialog } from "@/components/admin/create-group-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import { listGroupMembers } from "@/lib/group-members";
import { cn } from "@/lib/utils";
import type { GlobalPermission, Group, GroupMember, User } from "@/types/api";

const PERMISSIONS = [
  ["create_space", "Create spaces"],
  ["manage_users", "Manage users"],
  ["manage_groups", "Manage groups"],
  ["system_admin", "System admin"],
] as const;

const userLabel = (user: User | undefined, fallback: string) =>
  user ? user.full_name || "@" + user.username : fallback;

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPending, setEditPending] = useState(false);
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

  async function loadMembers(id: string) {
    if (members[id]) return;
    setMembersLoading(id);
    try {
      const next = await listGroupMembers(id);
      setMembers((current) => ({ ...current, [id]: next }));
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not load group members.",
      );
    } finally {
      setMembersLoading(null);
    }
  }

  async function toggle(group: Group) {
    const next = expanded === group.id ? null : group.id;
    setExpanded(next);
    if (next) await loadMembers(next);
  }

  async function removeGroup(group: Group) {
    setDeletePending(true);
    try {
      await api.delete("/api/v1/groups/" + group.id);
      setGroups((current) => current.filter((item) => item.id !== group.id));
      if (expanded === group.id) setExpanded(null);
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

  async function addMember(group: Group) {
    if (!memberId) return;
    try {
      await api.put("/api/v1/groups/" + group.id + "/members", {
        user_id: memberId,
      });
      const next = await listGroupMembers(group.id);
      setMembers((current) => ({ ...current, [group.id]: next }));
      setGroups((current) =>
        current.map((item) =>
          item.id === group.id ? { ...item, member_count: next.length } : item,
        ),
      );
      setMemberId("");
      toast.success("Member added.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not add member.",
      );
    }
  }

  async function removeMember(group: Group, id: string) {
    try {
      await api.delete("/api/v1/groups/" + group.id + "/members/" + id);
      const next = (members[group.id] ?? []).filter(
        (member) => member.user_id !== id,
      );
      setMembers((current) => ({ ...current, [group.id]: next }));
      setGroups((current) =>
        current.map((item) =>
          item.id === group.id ? { ...item, member_count: next.length } : item,
        ),
      );
      toast.success("Member removed.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not remove member.",
      );
    }
  }

  async function changeOwner(group: Group, nextOwnerId: string) {
    if (!nextOwnerId || nextOwnerId === group.owner_id) return;
    try {
      const owner = users.find((user) => user.id === nextOwnerId);
      await api.patch("/api/v1/groups/" + group.id, { owner_id: nextOwnerId });
      const next = await listGroupMembers(group.id);
      setMembers((current) => ({ ...current, [group.id]: next }));
      setGroups((current) =>
        current.map((item) =>
          item.id === group.id
            ? {
                ...item,
                owner_id: nextOwnerId,
                owner_username: owner?.username ?? null,
                member_count: next.length,
              }
            : item,
        ),
      );
      toast.success("Group owner updated.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not change group owner.",
      );
    }
  }

  function beginEdit(group: Group) {
    setExpanded(group.id);
    setEditingId(group.id);
    setEditName(group.name);
    setEditDescription(group.description);
    void loadMembers(group.id);
  }

  async function saveGroup(group: Group) {
    if (!editName.trim()) return;
    setEditPending(true);
    try {
      const updated = await api.patch<Group>("/api/v1/groups/" + group.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setGroups((current) =>
        current.map((item) => (item.id === group.id ? updated : item)),
      );
      setEditingId(null);
      toast.success("Group details updated.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not update group.",
      );
    } finally {
      setEditPending(false);
    }
  }

  async function togglePermission(
    group: Group,
    permission: string,
    enabled: boolean,
  ) {
    const path =
      "/api/v1/groups/" + group.id + "/global-permissions/" + permission;
    try {
      if (enabled) await api.put(path);
      else await api.delete(path);
      setGroups((current) =>
        current.map((item) =>
          item.id === group.id
            ? {
                ...item,
                global_permissions: enabled
                  ? [...item.global_permissions, permission as GlobalPermission]
                  : item.global_permissions.filter(
                      (value) => value !== permission,
                    ),
              }
            : item,
        ),
      );
      toast.success("Global permission updated.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not update permission.",
      );
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
              Select a group to manage its members and permissions.
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
                      open={expanded === group.id}
                      editing={editingId === group.id}
                      editName={editName}
                      editDescription={editDescription}
                      editPending={editPending}
                      members={members[group.id] ?? []}
                      loadingMembers={membersLoading === group.id}
                      users={users}
                      memberId={memberId}
                      onToggle={() => void toggle(group)}
                      onEdit={() => beginEdit(group)}
                      onDelete={() => setDeleteTarget(group)}
                      onEditNameChange={setEditName}
                      onEditDescriptionChange={setEditDescription}
                      onSave={() => void saveGroup(group)}
                      onCancelEdit={() => setEditingId(null)}
                      onOwnerChange={(value) => void changeOwner(group, value)}
                      onMemberChange={setMemberId}
                      onAddMember={() => void addMember(group)}
                      onRemoveMember={(id) => void removeMember(group, id)}
                      onPermissionChange={(permission, enabled) =>
                        void togglePermission(group, permission, enabled)
                      }
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

type GroupRowProps = {
  group: Group;
  open: boolean;
  editing: boolean;
  editName: string;
  editDescription: string;
  editPending: boolean;
  members: GroupMember[];
  loadingMembers: boolean;
  users: User[];
  memberId: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onOwnerChange: (value: string) => void;
  onMemberChange: (value: string) => void;
  onAddMember: () => void;
  onRemoveMember: (id: string) => void;
  onPermissionChange: (permission: string, enabled: boolean) => void;
};

function GroupRow(props: GroupRowProps) {
  const {
    group,
    open,
    editing,
    editName,
    editDescription,
    editPending,
    members,
    loadingMembers,
    users,
    memberId,
  } = props;
  const owner = users.find((user) => user.id === group.owner_id);
  const detailId = "group-" + group.id + "-details";
  const memberIds = new Set(members.map((member) => member.user_id));
  const availableUsers = users.filter((user) => !memberIds.has(user.id));
  return (
    <>
      <tr
        className={cn(
          "border-border border-b transition-colors duration-150",
          open ? "bg-surface-selected/40" : "hover:bg-surface-hover",
        )}
      >
        <td className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
              <UsersRound className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{group.name}</p>
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
              onClick={props.onEdit}
              aria-label={"Edit " + group.name}
            >
              <Pencil />
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={props.onDelete}
              aria-label={"Delete " + group.name}
              className="hover:bg-danger-bg hover:text-danger"
            >
              <Trash2 />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={props.onToggle}
              aria-label={open ? "Close " + group.name : "Manage " + group.name}
              aria-expanded={open}
              aria-controls={detailId}
            >
              {open ? <ChevronDown /> : <ChevronRight />}
            </Button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="border-border border-b">
          <td colSpan={5} className="bg-surface-sunken p-0">
            <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
              <div className="space-y-5">
                <section>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-medium">Group details</h4>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        Keep the name and description clear for workspace
                        admins.
                      </p>
                    </div>
                    {!editing ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={props.onEdit}
                      >
                        <Pencil />
                        Edit details
                      </Button>
                    ) : null}
                  </div>
                  {editing ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Input
                        value={editName}
                        onChange={(event) =>
                          props.onEditNameChange(event.target.value)
                        }
                        aria-label="Group name"
                        disabled={editPending}
                      />
                      <Input
                        value={editDescription}
                        onChange={(event) =>
                          props.onEditDescriptionChange(event.target.value)
                        }
                        aria-label="Group description"
                        disabled={editPending}
                      />
                      <div className="flex gap-2 sm:col-span-2">
                        <Button
                          size="sm"
                          onClick={props.onSave}
                          disabled={editPending || !editName.trim()}
                        >
                          {editPending ? (
                            <Loader2 className="animate-spin" />
                          ) : null}
                          Save changes
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={props.onCancelEdit}
                          disabled={editPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </section>
                <section className="border-border border-t pt-5">
                  <h4 className="font-medium">Owner</h4>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Owners stay in the group and can maintain its membership.
                  </p>
                  <Select
                    value={group.owner_id}
                    onValueChange={props.onOwnerChange}
                    disabled={users.length === 0}
                  >
                    <SelectTrigger
                      className="mt-3"
                      aria-label={group.name + " owner"}
                    >
                      <SelectValue>
                        {userLabel(
                          owner,
                          group.owner_username || "Choose an owner",
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name || user.username} (@{user.username})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>
                <section className="border-border border-t pt-5">
                  <h4 className="font-medium">Members</h4>
                  <div className="mt-3 flex gap-2">
                    <Select
                      value={memberId}
                      onValueChange={props.onMemberChange}
                      disabled={loadingMembers || availableUsers.length === 0}
                    >
                      <SelectTrigger
                        className="min-w-0 flex-1"
                        aria-label="Choose a member"
                      >
                        <SelectValue
                          placeholder={
                            availableUsers.length
                              ? "Add a member"
                              : "All users are members"
                          }
                        >
                          {userLabel(
                            availableUsers.find((user) => user.id === memberId),
                            availableUsers.length
                              ? "Add a member"
                              : "All users are members",
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.full_name || user.username} (@{user.username})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      onClick={props.onAddMember}
                      disabled={loadingMembers || !memberId}
                      aria-label="Add member"
                    >
                      <UserPlus />
                    </Button>
                  </div>
                  <div className="divide-border border-border bg-surface mt-3 divide-y rounded-md border">
                    {loadingMembers ? (
                      <p className="text-muted-foreground flex items-center gap-2 px-3 py-3 text-sm">
                        <Loader2 className="size-4 animate-spin" />
                        Loading members…
                      </p>
                    ) : members.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-3 text-sm">
                        No members yet.
                      </p>
                    ) : (
                      members.map((member) => {
                        const ownerMember = member.user_id === group.owner_id;
                        return (
                          <div
                            key={member.user_id}
                            className="hover:bg-surface-hover flex items-center justify-between gap-3 px-3 py-2 transition-colors duration-150"
                          >
                            <span className="min-w-0">
                              <span className="truncate font-medium">
                                {member.full_name || member.username}
                              </span>
                              <span className="text-muted-foreground ml-1 text-xs">
                                @{member.username}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {ownerMember ? (
                                <Badge variant="neutral">Owner</Badge>
                              ) : null}
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  props.onRemoveMember(member.user_id)
                                }
                                disabled={ownerMember}
                                aria-label={"Remove " + member.username}
                                className="hover:bg-danger-bg hover:text-danger"
                              >
                                <UserMinus />
                              </Button>
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
              <section className="border-border border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-muted-foreground size-4" />
                  <h4 className="font-medium">Global permissions</h4>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  These permissions apply across the workspace, not just one
                  space.
                </p>
                <div className="mt-4 space-y-2">
                  {PERMISSIONS.map(([permission, label]) => {
                    const checked = group.global_permissions.includes(
                      permission as GlobalPermission,
                    );
                    return (
                      <label
                        key={permission}
                        className="border-border bg-surface hover:border-border-strong flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150"
                      >
                        <span className="text-sm font-medium">{label}</span>
                        <input
                          className="accent-primary border-border focus-visible:ring-ring size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            props.onPermissionChange(
                              permission,
                              event.target.checked,
                            )
                          }
                          aria-label={label}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

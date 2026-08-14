"use client";

import { Loader2, Pencil, Plus, Search, Trash2, UserPlus, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import type { GlobalPermission, Group, GroupMember, User } from "@/types/api";

const GLOBAL_PERMISSIONS = [
  ["create_space", "Create spaces"],
  ["manage_users", "Manage users"],
  ["manage_groups", "Manage groups"],
  ["system_admin", "System admin"],
] as const;

export function GroupManager({ initialGroups, users }: { initialGroups: Group[]; users: User[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(users[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPending, setEditPending] = useState(false);

  const filteredGroups = groups.filter((group) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${group.name} ${group.description} ${group.owner_username ?? ""}`
      .toLowerCase()
      .includes(needle);
  });

  async function createGroup() {
    if (!name.trim() || !ownerId) return;
    setPending(true);
    try {
      const group = await api.post<Group>("/api/v1/groups", {
        name: name.trim(), description: description.trim(), owner_id: ownerId,
      });
      setGroups((current) => [...current, group].sort((a, b) => a.name.localeCompare(b.name)));
      setName(""); setDescription("");
      toast.success(`Group "${group.name}" created.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create group.");
    } finally { setPending(false); }
  }

  async function removeGroup(group: Group) {
    setDeletePending(true);
    try {
      await api.delete(`/api/v1/groups/${group.id}`);
      setGroups((current) => current.filter((item) => item.id !== group.id));
      toast.success("Group deleted.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not delete group.");
    } finally { setDeletePending(false); setDeleteTarget(null); }
  }

  async function addMember(group: Group) {
    if (!memberId) return;
    try {
      await api.put(`/api/v1/groups/${group.id}/members`, { user_id: memberId });
      setMemberId("");
      const nextMembers = await listGroupMembers(group.id);
      setMembers((current) => ({ ...current, [group.id]: nextMembers }));
      toast.success("Member added.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not add member.");
    }
  }

  async function removeMember(group: Group, userId: string) {
    try {
      await api.delete(`/api/v1/groups/${group.id}/members/${userId}`);
      setMembers((current) => ({
        ...current,
        [group.id]: (current[group.id] ?? []).filter((member) => member.user_id !== userId),
      }));
      setGroups((current) => current.map((item) => item.id === group.id
        ? { ...item, member_count: Math.max(0, item.member_count - 1) }
        : item));
      toast.success("Member removed.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not remove member.");
    }
  }

  async function changeOwner(group: Group, ownerId: string) {
    if (!ownerId || ownerId === group.owner_id) return;
    try {
      const owner = users.find((user) => user.id === ownerId);
      await api.patch(`/api/v1/groups/${group.id}`, { owner_id: ownerId });
      setGroups((current) => current.map((item) => item.id === group.id
        ? { ...item, owner_id: ownerId, owner_username: owner?.username ?? null }
        : item));
      const nextMembers = await listGroupMembers(group.id);
      setMembers((current) => ({ ...current, [group.id]: nextMembers }));
      toast.success("Group owner updated.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not change group owner.");
    }
  }

  function startEditing(group: Group) {
    setEditingId(group.id);
    setEditName(group.name);
    setEditDescription(group.description);
  }

  async function saveGroup(group: Group) {
    if (!editName.trim()) return;
    setEditPending(true);
    try {
      const updated = await api.patch<Group>(`/api/v1/groups/${group.id}`, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setGroups((current) => current.map((item) => item.id === group.id ? updated : item));
      setEditingId(null);
      toast.success("Group details updated.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update group.");
    } finally {
      setEditPending(false);
    }
  }

  async function toggleGroup(group: Group) {
    const next = expanded === group.id ? null : group.id;
    setExpanded(next);
    if (next && !members[next]) {
      setMembersLoading(next);
      try {
        const nextMembers = await listGroupMembers(next);
        setMembers((current) => ({ ...current, [next]: nextMembers }));
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Could not load group members.");
      } finally {
        setMembersLoading(null);
      }
    }
  }

  async function toggleGlobal(group: Group, permission: string, enabled: boolean) {
    const path = `/api/v1/groups/${group.id}/global-permissions/${permission}`;
    try {
      if (enabled) await api.put(path); else await api.delete(path);
      setGroups((current) => current.map((item) => item.id === group.id
        ? { ...item, global_permissions: enabled
          ? [...item.global_permissions, permission as GlobalPermission]
          : item.global_permissions.filter((value) => value !== permission) }
        : item));
      toast.success("Global permission updated.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update permission.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="border-border bg-surface rounded-xl border p-4 shadow-sm">
        <div className="flex items-center gap-2"><Plus className="size-4 text-primary" /><h3 className="font-medium">Create group</h3></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Engineering" aria-label="Group name" />
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" aria-label="Group description" />
          <Select value={ownerId} onValueChange={setOwnerId} disabled={users.length === 0 || pending}>
            <SelectTrigger aria-label="Group owner">
              <SelectValue placeholder="Choose an owner">
                {users.find((user) => user.id === ownerId)?.full_name || users.find((user) => user.id === ownerId)?.username || "Choose an owner"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.full_name || user.username} (@{user.username})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="mt-3" onClick={createGroup} disabled={pending || !name.trim() || !ownerId}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Create group</Button>
      </div>

      <div className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex items-center gap-2 border-b p-3">
          <Search className="text-muted-foreground size-4" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search groups..." aria-label="Search groups" className="border-0 shadow-none focus-visible:ring-0" />
          <span className="text-muted-foreground shrink-0 text-xs">{filteredGroups.length} of {groups.length}</span>
        </div>
        {groups.length === 0 ? <p className="text-muted-foreground p-6 text-sm">No groups yet.</p> : filteredGroups.length === 0 ? <p className="text-muted-foreground p-6 text-sm">No groups match your search.</p> : filteredGroups.map((group) => {
          const open = expanded === group.id;
          return <div key={group.id} className="border-border border-b p-4 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <button type="button" onClick={() => void toggleGroup(group)} className="hover:bg-surface-hover focus-visible:ring-ring -m-2 rounded-md p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
                <p className="font-medium">{group.name}</p><p className="text-muted-foreground mt-0.5 text-xs">{group.description || "No description"} · {group.member_count} members · owner @{group.owner_username}</p>
              </button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => startEditing(group)} aria-label={`Edit ${group.name}`} title="Edit group"><Pencil /></Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(group)} aria-label={`Delete ${group.name}`} title="Delete group"><Trash2 /></Button>
              </div>
            </div>
            {open ? <div className="border-border mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
              <div>
                {editingId === group.id ? <div className="border-border bg-surface-sunken rounded-lg border p-3">
                  <p className="text-sm font-medium">Edit group</p>
                  <div className="mt-2 space-y-2">
                    <Input value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="Group name" placeholder="Group name" />
                    <Input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} aria-label="Group description" placeholder="Description" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveGroup(group)} disabled={editPending || !editName.trim()}>{editPending ? <Loader2 className="animate-spin" /> : null}Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={editPending}>Cancel</Button>
                    </div>
                  </div>
                </div> : null}
                <p className="text-sm font-medium">Group owner</p>
                <Select value={group.owner_id} onValueChange={(value) => void changeOwner(group, value)} disabled={users.length === 0}>
                  <SelectTrigger className="mt-2" aria-label={`${group.name} owner`}>
                    <SelectValue>
                      {users.find((user) => user.id === group.owner_id)?.full_name || users.find((user) => user.id === group.owner_id)?.username || group.owner_username || "Choose an owner"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.full_name || user.username} (@{user.username})</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground mt-1 text-xs">The new owner is automatically kept as a member.</p>
                <p className="mt-4 text-sm font-medium">Add member</p>
                <div className="mt-2 flex gap-2">
                  <Select value={memberId} onValueChange={setMemberId} disabled={users.length === 0}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label="Choose a user">
                      <SelectValue placeholder="Choose a user">
                        {users.find((user) => user.id === memberId)?.full_name || users.find((user) => user.id === memberId)?.username || "Choose a user"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.full_name || user.username}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="icon" onClick={() => void addMember(group)} disabled={!memberId} aria-label="Add member"><UserPlus /></Button>
                </div>
                <div className="mt-3 space-y-1">
                  {membersLoading === group.id ? <p className="text-muted-foreground flex items-center gap-2 text-xs"><Loader2 className="animate-spin" /> Loading members...</p> : (members[group.id] ?? []).map((member) => <div key={member.user_id} className="hover:bg-surface-hover flex items-center justify-between rounded px-2 py-1.5 text-sm"><span>{member.full_name || member.username} <span className="text-muted-foreground">@{member.username}</span></span><Button variant="ghost" size="icon" onClick={() => void removeMember(group, member.user_id)} disabled={member.user_id === group.owner_id} aria-label={`Remove ${member.username}`} title={member.user_id === group.owner_id ? "Transfer ownership first" : "Remove member"}><UserMinus /></Button></div>)}
                </div>
              </div>
              <div><p className="text-sm font-medium">Global permissions</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{GLOBAL_PERMISSIONS.map(([permission, label]) => <label key={permission} className="hover:bg-surface-hover flex items-center gap-2 rounded px-2 py-1.5 text-sm"><input type="checkbox" checked={group.global_permissions.includes(permission as GlobalPermission)} onChange={(event) => toggleGlobal(group, permission, event.target.checked)} />{label}</label>)}</div></div>
            </div> : null}
          </div>;
        })}
      </div>
      <ConfirmDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deletePending) setDeleteTarget(null); }} title="Delete group?" description={deleteTarget ? `This removes the group "${deleteTarget.name}". Existing Space permissions must be removed first.` : ""} confirmLabel="Delete group" destructive pending={deletePending} onConfirm={() => { if (deleteTarget) void removeGroup(deleteTarget); }} />
    </div>
  );
}

"use client";

import {
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type TabKey = "details" | "members" | "permissions";

export function EditGroupDialog({
  group,
  open,
  onOpenChange,
  users,
  onGroupUpdated,
}: {
  group: Group | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  onGroupUpdated: (updatedGroup: Group) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberIdToAdd, setMemberIdToAdd] = useState("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [globalPermissions, setGlobalPermissions] = useState<GlobalPermission[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (group && open) {
      setName(group.name);
      setDescription(group.description || "");
      setOwnerId(group.owner_id || "");
      setGlobalPermissions(group.global_permissions || []);
      setActiveTab("details");
      setError(null);
      void loadMembers(group.id);
    }
  }, [group, open]);

  async function loadMembers(groupId: string) {
    setLoadingMembers(true);
    try {
      const data = await listGroupMembers(groupId);
      setMembers(data);
    } catch {
      // Best-effort load
    } finally {
      setLoadingMembers(false);
    }
  }

  if (!group) return null;

  async function handleSaveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !group) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<Group>(`/api/v1/groups/${group.id}`, {
        name: name.trim(),
        description: description.trim(),
        owner_id: ownerId || undefined,
      });
      onGroupUpdated(updated);
      toast.success("Group details updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update group details.");
    } finally {
      setPending(false);
    }
  }

  async function handleAddMember() {
    if (!memberIdToAdd || !group) return;
    setPending(true);
    try {
      await api.put(`/api/v1/groups/${group.id}/members`, {
        user_id: memberIdToAdd,
      });
      const nextMembers = await listGroupMembers(group.id);
      setMembers(nextMembers);
      setMemberIdToAdd("");
      const updatedGroup = { ...group, member_count: nextMembers.length };
      onGroupUpdated(updatedGroup);
      toast.success("Member added.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add member.");
    } finally {
      setPending(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!group) return;
    try {
      await api.delete(`/api/v1/groups/${group.id}/members/${userId}`);
      const nextMembers = members.filter((m) => m.user_id !== userId);
      setMembers(nextMembers);
      const updatedGroup = { ...group, member_count: nextMembers.length };
      onGroupUpdated(updatedGroup);
      toast.success("Member removed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove member.");
    }
  }

  async function handleTogglePermission(permission: GlobalPermission, enabled: boolean) {
    if (!group) return;
    const path = `/api/v1/groups/${group.id}/global-permissions/${permission}`;
    try {
      if (enabled) await api.put(path);
      else await api.delete(path);
      const nextPerms = enabled
        ? [...globalPermissions, permission]
        : globalPermissions.filter((p) => p !== permission);
      setGlobalPermissions(nextPerms);
      const updatedGroup = { ...group, global_permissions: nextPerms };
      onGroupUpdated(updatedGroup);
      toast.success("Global permission updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update permission.");
    }
  }

  const memberIds = new Set(members.map((m) => m.user_id));
  const availableUsersToAdd = users.filter((u) => !memberIds.has(u.id));

  const filteredMembers = members.filter((m) => {
    if (!memberSearchQuery.trim()) return true;
    const q = memberSearchQuery.toLowerCase().trim();
    return (m.full_name || m.username).toLowerCase().includes(q) || m.username.toLowerCase().includes(q);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        title={`Edit group "${group.name}"`}
        description="Manage group details, member assignments, and global permissions."
      >
        {/* Navigation Tabs */}
        <div className="border-border border-b flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "details"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Pencil className="size-4" />
            General details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "members"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <UsersRound className="size-4" />
            Members ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("permissions")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "permissions"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldCheck className="size-4" />
            Global access
          </button>
        </div>

        {error ? (
          <p role="alert" className="border-danger/30 bg-danger/10 text-danger mt-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {/* Tab 1: General Details */}
        {activeTab === "details" ? (
          <form onSubmit={handleSaveDetails} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-name">Group name</Label>
              <Input
                id="edit-group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-description">Description</Label>
              <Input
                id="edit-group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description of group purpose"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-owner">Group owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId} disabled={pending}>
                <SelectTrigger id="edit-group-owner">
                  <SelectValue placeholder="Select owner">
                    {users.find((u) => u.id === ownerId)?.full_name ||
                      users.find((u) => u.id === ownerId)?.username ||
                      "Select owner"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || u.username} (@{u.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {/* Tab 2: Members */}
        {activeTab === "members" ? (
          <div className="mt-4 space-y-4">
            {/* Add member section */}
            <div className="border-border bg-surface-sunken flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <Select value={memberIdToAdd} onValueChange={setMemberIdToAdd} disabled={availableUsersToAdd.length === 0}>
                <SelectTrigger className="flex-1 min-w-48">
                  <SelectValue placeholder={availableUsersToAdd.length > 0 ? "Select user to add..." : "All users are members"} />
                </SelectTrigger>
                <SelectContent>
                  {availableUsersToAdd.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || u.username} (@{u.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                onClick={handleAddMember}
                disabled={!memberIdToAdd || pending}
              >
                <UserPlus className="size-4" />
                Add member
              </Button>
            </div>

            {/* Member search filter */}
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                placeholder="Search group members..."
                className="w-full pl-8"
              />
            </div>

            {/* Members list */}
            <div className="border-border max-h-64 divide-y overflow-y-auto rounded-lg border">
              {loadingMembers ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin mb-2" />
                  Loading members...
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No members found in this group.
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <div key={member.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="bg-primary-subtle text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                        {(member.full_name || member.username)[0]?.toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{member.full_name || member.username}</p>
                        <p className="text-xs text-muted-foreground truncate">@{member.username}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="hover:bg-danger-bg hover:text-danger text-muted-foreground"
                      onClick={() => handleRemoveMember(member.user_id)}
                      title="Remove member from group"
                    >
                      <UserMinus className="size-4" />
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {/* Tab 3: Global Permissions */}
        {activeTab === "permissions" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Configure workspace-wide administrative access granted to all members of this group.
            </p>
            <div className="space-y-2">
              {PERMISSIONS.map(([permission, label]) => {
                const isEnabled = globalPermissions.includes(permission as GlobalPermission);
                return (
                  <div
                    key={permission}
                    className="border-border bg-surface-raised flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{permission}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isEnabled ? "primary" : "secondary"}
                      onClick={() => handleTogglePermission(permission as GlobalPermission, !isEnabled)}
                    >
                      {isEnabled ? "Enabled" : "Enable"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import {
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  ["create_space", "Create spaces", "Allows creating new documentation spaces in the workspace."],
  ["manage_users", "Manage users", "Allows creating, editing, and deactivating user accounts."],
  ["manage_groups", "Manage groups", "Allows creating, editing, and assigning user groups."],
  ["system_admin", "System admin", "Full administrative control over workspace settings and data."],
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
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberIdToAdd, setMemberIdToAdd] = useState("");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [globalPermissions, setGlobalPermissions] = useState<GlobalPermission[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevGroupIdRef = useRef<string | null>(null);
  const prevOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    const isJustOpened = !prevOpenRef.current;
    const isDifferentGroup = prevGroupIdRef.current !== group?.id;

    if (group && (isJustOpened || isDifferentGroup)) {
      setName(group.name);
      setDescription(group.description || "");
      setOwnerIds(group.owner_id ? [group.owner_id] : []);
      setGlobalPermissions(group.global_permissions || []);
      setActiveTab("details");
      setError(null);
      void loadMembers(group.id);
      prevGroupIdRef.current = group.id;
    }
    prevOpenRef.current = open;
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

  // Change detection for General Details
  const isNameChanged = name.trim() !== group.name;
  const isDescChanged = description.trim() !== (group.description || "");
  const initialOwnerIds = group.owner_id ? [group.owner_id] : [];
  const isOwnerChanged =
    ownerIds.length !== initialOwnerIds.length ||
    ownerIds.some((id, idx) => id !== initialOwnerIds[idx]);

  const hasChanges = isNameChanged || isDescChanged || isOwnerChanged;

  function handleAddOwner(userId: string) {
    if (!userId || ownerIds.includes(userId)) return;
    setOwnerIds((current) => [...current, userId]);
  }

  function handleRemoveOwner(userId: string) {
    if (ownerIds.length <= 1) {
      toast.error("Group must have at least one owner.");
      return;
    }
    setOwnerIds((current) => current.filter((id) => id !== userId));
  }

  async function handleSaveDetails() {
    if (!name.trim() || ownerIds.length === 0 || !group) return;
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await api.patch<Group>(`/api/v1/groups/${group.id}`, {
        name: name.trim(),
        description: description.trim(),
        owner_id: ownerIds[0],
      });
      // Ensure all selected owners are also group members
      const existingMemberIds = new Set(members.map((m) => m.user_id));
      const newOwnerMembers = ownerIds.filter((id) => !existingMemberIds.has(id));
      if (newOwnerMembers.length > 0) {
        await Promise.all(
          newOwnerMembers.map((id) =>
            api.put(`/api/v1/groups/${group.id}/members`, { user_id: id }).catch(() => {}),
          ),
        );
        const nextMembers = await listGroupMembers(group.id);
        setMembers(nextMembers);
        onGroupUpdated({ ...updated, member_count: nextMembers.length });
      } else {
        onGroupUpdated(updated);
      }
      toast.success("Group details updated.");
      onOpenChange(false);
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
  const availableUsersToAdd = users
    .filter((u) => !memberIds.has(u.id))
    .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));

  const availableOwners = users
    .filter((u) => !ownerIds.includes(u.id))
    .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));

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

        {/* Tab Content Container with Fixed Height */}
        <div className="mt-4 h-[340px] min-h-[340px] overflow-y-auto">
          {/* Tab 1: General Details */}
          {activeTab === "details" ? (
            <div className="space-y-4 pr-1">
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
                <Label>Group owners</Label>
                <div className="border border-border rounded-lg p-2.5 bg-surface space-y-2">
                  <div className="flex flex-wrap gap-1.5 min-h-8 items-center">
                    {ownerIds.map((id) => {
                      const u = users.find((user) => user.id === id);
                      return (
                        <Badge key={id} variant="info" className="flex items-center gap-1.5 py-1 px-2.5 text-xs font-medium">
                          <span>{u?.full_name || u?.username || id}</span>
                          {ownerIds.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveOwner(id)}
                              className="hover:text-danger text-muted-foreground ml-0.5 cursor-pointer rounded-xs"
                              title="Remove owner"
                              disabled={pending}
                            >
                              <X className="size-3" />
                            </button>
                          ) : null}
                        </Badge>
                      );
                    })}
                  </div>

                  {availableOwners.length > 0 ? (
                    <Select value="" onValueChange={handleAddOwner} disabled={pending}>
                      <SelectTrigger className="w-full text-xs h-8">
                        <SelectValue placeholder="+ Add owner..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 overflow-y-auto">
                        {availableOwners.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.full_name || u.username} (@{u.username})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Tab 2: Members */}
          {activeTab === "members" ? (
            <div className="space-y-4 flex flex-col h-full min-h-0">
              {/* Add member section */}
              <div className="border-border bg-surface-sunken flex flex-wrap items-center gap-2 rounded-lg border p-3 shrink-0">
                <Select value={memberIdToAdd} onValueChange={setMemberIdToAdd} disabled={availableUsersToAdd.length === 0}>
                  <SelectTrigger className="flex-1 min-w-48">
                    <SelectValue placeholder={availableUsersToAdd.length > 0 ? "Select user to add..." : "All users are members"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
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
              <div className="relative shrink-0">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="Search group members..."
                  className="w-full pl-8"
                />
              </div>

              {/* Members list */}
              <div className="border-border flex-1 divide-y overflow-y-auto rounded-lg border min-h-0">
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

          {/* Tab 3: Global Permissions (Table Format) */}
          {activeTab === "permissions" ? (
            <div className="space-y-3 flex flex-col h-full min-h-0">
              <p className="text-xs text-muted-foreground shrink-0">
                Configure workspace-wide administrative permissions granted to members of this group.
              </p>
              <div className="border-border flex-1 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs uppercase tracking-wider font-semibold">
                      <th className="px-4 py-2.5">Permission</th>
                      <th className="px-4 py-2.5">Key</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5 text-right">Status / Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {PERMISSIONS.map(([permission, label, desc]) => {
                      const isEnabled = globalPermissions.includes(permission as GlobalPermission);
                      return (
                        <tr key={permission} className="hover:bg-surface-hover transition-colors">
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{label}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{permission}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{desc}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Button
                              type="button"
                              size="sm"
                              variant={isEnabled ? "primary" : "secondary"}
                              onClick={() => handleTogglePermission(permission as GlobalPermission, !isEnabled)}
                            >
                              {isEnabled ? "Enabled" : "Enable"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* Global Dialog Footer Visible across ALL Tabs */}
        <DialogFooter className="pt-4 border-t border-border mt-3">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSaveDetails()}
            variant={hasChanges ? "primary" : "secondary"}
            disabled={!hasChanges || !name.trim() || ownerIds.length === 0 || pending}
            className={cn(
              hasChanges
                ? "bg-primary text-primary-foreground font-medium shadow-sm hover:bg-primary-hover"
                : "opacity-50 cursor-not-allowed",
            )}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

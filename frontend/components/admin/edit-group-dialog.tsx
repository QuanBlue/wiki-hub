"use client";

import {
  Check,
  ChevronDown,
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

function SearchableUserPicker({
  users,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  users: User[];
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedUser = users.find((u) => u.id === value);

  const filteredUsers = users.filter((u) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    return (
      (u.full_name || "").toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-48">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "w-full flex items-center justify-between border border-border rounded-md px-3 py-2 text-xs bg-background hover:bg-surface-hover transition-colors text-left font-normal cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
          open && "ring-2 ring-primary/20 border-primary",
        )}
      >
        <span className={cn("truncate", !selectedUser && "text-muted-foreground")}>
          {selectedUser
            ? `${selectedUser.full_name || selectedUser.username} (@${selectedUser.username})`
            : placeholder}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground shrink-0 ml-1" />
      </button>

      {open && !disabled ? (
        <div className="absolute top-full left-0 mt-1 w-full z-50 bg-surface text-foreground border border-border rounded-md shadow-xl p-1.5 space-y-1.5 min-w-64">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search user by name or @username..."
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="max-h-48 overflow-y-auto space-y-0.5 divide-y divide-border/40">
            {filteredUsers.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching users found.
              </div>
            ) : (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onChange(u.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer",
                    u.id === value && "bg-accent/50 font-medium",
                  )}
                >
                  <span className="size-5 rounded-full bg-primary-subtle text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
                    {(u.full_name || u.username)[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.full_name || u.username}</p>
                    <p className="truncate text-[10px] text-muted-foreground">@{u.username}</p>
                  </div>
                  {u.id === value ? <Check className="size-3 text-primary shrink-0" /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  const [pendingAddedUserIds, setPendingAddedUserIds] = useState<string[]>([]);
  const [pendingRemovedUserIds, setPendingRemovedUserIds] = useState<string[]>([]);
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
      setPendingAddedUserIds([]);
      setPendingRemovedUserIds([]);
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
  const isMembersChanged = pendingAddedUserIds.length > 0 || pendingRemovedUserIds.length > 0;

  const initialPerms = group.global_permissions || [];
  const isPermissionsChanged =
    globalPermissions.length !== initialPerms.length ||
    globalPermissions.some((p) => !initialPerms.includes(p));

  const hasChanges =
    isNameChanged || isDescChanged || isOwnerChanged || isMembersChanged || isPermissionsChanged;

  function handleAddOwner(userId: string) {
    if (!userId || ownerIds.includes(userId)) return;
    setOwnerIds((current) => [...current, userId]);
    // Also stage newly added owner as a group member if not already
    const existingMemberUserIds = new Set(members.map((m) => m.user_id));
    if (!existingMemberUserIds.has(userId) && !pendingAddedUserIds.includes(userId)) {
      setPendingAddedUserIds((prev) => [userId, ...prev]);
    }
  }

  function handleRemoveOwner(userId: string) {
    if (ownerIds.length <= 1) {
      toast.error("Group must have at least one owner.");
      return;
    }
    setOwnerIds((current) => current.filter((id) => id !== userId));
  }

  function handleStageAddMember() {
    if (!memberIdToAdd || pendingAddedUserIds.includes(memberIdToAdd)) return;
    setPendingAddedUserIds((prev) => [memberIdToAdd, ...prev]);
    setPendingRemovedUserIds((prev) => prev.filter((id) => id !== memberIdToAdd));
    setMemberIdToAdd("");
  }

  function handleStageRemoveMember(userId: string) {
    if (pendingAddedUserIds.includes(userId)) {
      setPendingAddedUserIds((prev) => prev.filter((id) => id !== userId));
    } else {
      setPendingRemovedUserIds((prev) => [...prev, userId]);
    }
  }

  function handleTogglePermission(permission: GlobalPermission, enabled: boolean) {
    setGlobalPermissions((prev) =>
      enabled ? [...prev, permission] : prev.filter((p) => p !== permission),
    );
  }

  async function handleSaveAll() {
    if (!name.trim() || ownerIds.length === 0 || !group) return;
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      let updated = group;
      // Send the latest selected owner ID as the group owner
      const targetOwnerId = ownerIds[ownerIds.length - 1] || ownerIds[0];
      if (isNameChanged || isDescChanged || isOwnerChanged) {
        updated = await api.patch<Group>(`/api/v1/groups/${group.id}`, {
          name: name.trim(),
          description: description.trim(),
          owner_id: targetOwnerId,
        });
      }

      // Add newly staged members
      if (pendingAddedUserIds.length > 0) {
        await Promise.all(
          pendingAddedUserIds.map((userId) =>
            api.put(`/api/v1/groups/${group.id}/members`, { user_id: userId }).catch(() => {}),
          ),
        );
      }

      // Remove staged deleted members
      if (pendingRemovedUserIds.length > 0) {
        await Promise.all(
          pendingRemovedUserIds.map((userId) =>
            api.delete(`/api/v1/groups/${group.id}/members/${userId}`).catch(() => {}),
          ),
        );
      }

      // Process global permission changes
      const permsToAdd = globalPermissions.filter((p) => !initialPerms.includes(p));
      const permsToRemove = initialPerms.filter((p) => !globalPermissions.includes(p));

      if (permsToAdd.length > 0) {
        await Promise.all(
          permsToAdd.map((p) =>
            api.put(`/api/v1/groups/${group.id}/global-permissions/${p}`).catch(() => {}),
          ),
        );
      }

      if (permsToRemove.length > 0) {
        await Promise.all(
          permsToRemove.map((p) =>
            api.delete(`/api/v1/groups/${group.id}/global-permissions/${p}`).catch(() => {}),
          ),
        );
      }

      const nextMembers = await listGroupMembers(group.id);
      setMembers(nextMembers);
      setPendingAddedUserIds([]);
      setPendingRemovedUserIds([]);

      const updatedGroup = {
        ...updated,
        member_count: nextMembers.length,
        global_permissions: globalPermissions,
      };
      onGroupUpdated(updatedGroup);
      toast.success("Group changes saved.");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save group changes.");
    } finally {
      setPending(false);
    }
  }

  // Active membership state calculation
  const currentMemberUserIds = new Set([
    ...members.map((m) => m.user_id).filter((id) => !pendingRemovedUserIds.includes(id)),
    ...pendingAddedUserIds,
  ]);

  const availableUsersToAdd = users
    .filter((u) => !currentMemberUserIds.has(u.id))
    .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));

  const availableOwners = users
    .filter((u) => !ownerIds.includes(u.id))
    .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));

  // Display items: Staged Added (NEW) at the very top, followed by existing members
  const stagedNewMembers = pendingAddedUserIds.map((userId) => {
    const u = users.find((user) => user.id === userId);
    return {
      user_id: userId,
      username: u?.username || userId,
      full_name: u?.full_name || u?.username || userId,
      isNew: true,
    };
  });

  const existingActiveMembers = members
    .filter((m) => !pendingRemovedUserIds.includes(m.user_id))
    .map((m) => ({ ...m, isNew: false }));

  const allDisplayedMembers = [...stagedNewMembers, ...existingActiveMembers];

  const filteredMembers = allDisplayedMembers.filter((m) => {
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
            Members ({allDisplayedMembers.length})
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
        <div className="mt-4 h-[350px] min-h-[350px]">
          {/* Tab 1: General Details */}
          {activeTab === "details" ? (
            <div className="space-y-4 pr-1 h-full overflow-visible">
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
                    <SearchableUserPicker
                      users={availableOwners}
                      value=""
                      onChange={handleAddOwner}
                      disabled={pending}
                      placeholder="+ Add owner..."
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Tab 2: Members */}
          {activeTab === "members" ? (
            <div className="space-y-3 h-full flex flex-col">
              {/* Add member section with SearchableUserPicker */}
              <div className="border-border bg-surface-sunken flex flex-wrap items-center gap-2 rounded-lg border p-3 shrink-0">
                <SearchableUserPicker
                  users={availableUsersToAdd}
                  value={memberIdToAdd}
                  onChange={setMemberIdToAdd}
                  disabled={availableUsersToAdd.length === 0}
                  placeholder={availableUsersToAdd.length > 0 ? "Select user to add..." : "All users are members"}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleStageAddMember}
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
                  placeholder="Search current group members..."
                  className="w-full pl-8"
                />
              </div>

              {/* Members list */}
              <div className="border-border flex-1 max-h-[200px] min-h-[160px] overflow-y-auto rounded-lg border divide-y">
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
                        <div className="min-w-0 flex items-center gap-2">
                          <p className="font-medium truncate">{member.full_name || member.username}</p>
                          <p className="text-xs text-muted-foreground truncate">@{member.username}</p>
                          {member.isNew ? (
                            <Badge variant="success" className="text-[10px] py-0 px-1.5 font-semibold uppercase tracking-wider">
                              New
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="hover:bg-danger-bg hover:text-danger text-muted-foreground"
                        onClick={() => handleStageRemoveMember(member.user_id)}
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
            <div className="space-y-3 h-full flex flex-col">
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
            onClick={() => void handleSaveAll()}
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

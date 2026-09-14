"use client";

import {
  Check,
  ChevronDown,
  Crown,
  FolderKanban,
  Loader2,
  Pencil,
  PlusCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { GroupUsagePanel } from "@/components/admin/group-usage-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { getGroupUsage, listGroupMembers } from "@/lib/group-members";
import { cn } from "@/lib/utils";
import type { GlobalPermission, Group, GroupMember, GroupUsage, User } from "@/types/api";

const PERMISSION_CONFIG: Record<
  GlobalPermission,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  create_space: {
    label: "Create spaces",
    description: "Allows group members to create new documentation spaces in the workspace.",
    icon: PlusCircle,
  },
  manage_users: {
    label: "Manage users",
    description: "Allows creating, editing, resetting passwords, and deactivating user accounts.",
    icon: Users,
  },
  manage_groups: {
    label: "Manage groups",
    description: "Allows creating, updating, assigning members, and managing user groups.",
    icon: FolderKanban,
  },
  system_admin: {
    label: "System administrator",
    description: "Full administrative control over workspace settings, security, and system backups.",
    icon: ShieldAlert,
  },
};

type TabKey = "details" | "members" | "usage" | "permissions";

function SearchableUserPicker({
  users,
  value,
  onChange,
  disabled,
  placeholder,
  addedUserIds,
  side = "bottom",
}: {
  users: User[];
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  placeholder: string;
  addedUserIds?: Set<string> | string[];
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const addedSet =
    addedUserIds instanceof Set
      ? addedUserIds
      : new Set(addedUserIds || []);

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
    <div ref={containerRef} className="relative flex-1 min-w-44">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "w-full flex items-center justify-between border border-border rounded-md px-2.5 py-1.5 text-xs bg-background hover:bg-surface-hover transition-colors text-left font-normal cursor-pointer h-8",
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
        <div
          className={cn(
            "absolute left-0 w-full z-50 bg-surface text-foreground border border-border rounded-md shadow-xl p-1.5 space-y-1.5 min-w-64",
            side === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
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
              filteredUsers.map((u) => {
                const isAlreadyAdded = addedSet.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={isAlreadyAdded}
                    onClick={() => {
                      if (isAlreadyAdded) return;
                      onChange(u.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm text-left transition-colors",
                      isAlreadyAdded
                        ? "opacity-60 cursor-not-allowed bg-muted/20"
                        : "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                      u.id === value && !isAlreadyAdded && "bg-accent/50 font-medium",
                    )}
                  >
                    <span className="size-5 rounded-full bg-primary-subtle text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {(u.full_name || u.username)[0]?.toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.full_name || u.username}</p>
                      <p className="truncate text-[10px] text-muted-foreground">@{u.username}</p>
                    </div>
                    {isAlreadyAdded ? (
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/60 shrink-0">
                        Added
                      </span>
                    ) : u.id === value ? (
                      <Check className="size-3 text-primary shrink-0" />
                    ) : null}
                  </button>
                );
              })
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
  const [usage, setUsage] = useState<GroupUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevGroupIdRef = useRef<string | null>(null);
  const prevOpenRef = useRef<boolean>(false);

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

  async function loadUsage(groupId: string) {
    setLoadingUsage(true);
    try {
      const data = await getGroupUsage(groupId);
      setUsage(data);
    } catch {
      // Best-effort load
    } finally {
      setLoadingUsage(false);
    }
  }

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
      const initialOwners =
        group.owner_ids && group.owner_ids.length > 0
          ? group.owner_ids
          : group.owner_id
            ? [group.owner_id]
            : [];
      setOwnerIds(initialOwners);
      setGlobalPermissions(group.global_permissions || []);
      setPendingAddedUserIds([]);
      setPendingRemovedUserIds([]);
      setActiveTab("details");
      setError(null);
      setUsage(null);
      void loadMembers(group.id);
      void loadUsage(group.id);
      prevGroupIdRef.current = group.id;
    }
    prevOpenRef.current = open;
  }, [group, open]);

  if (!group) return null;

  // Removal in the Used in tab is immediate (see `GroupUsagePanel`), not
  // staged behind Save like the rest of this dialog - so the Directory
  // table's own counts need to hear about it right away too, not just this
  // dialog's local state.
  function handleUsageChanged(next: GroupUsage) {
    setUsage(next);
    // `group` is narrowed non-null above, but that narrowing doesn't carry
    // into this closure - it's a stable prop, never reassigned, so this is
    // safe.
    onGroupUpdated({ ...group!, space_count: next.spaces.length, page_count: next.pages.length });
  }

  // Change detection for General Details
  const isNameChanged = name.trim() !== group.name;
  const isDescChanged = description.trim() !== (group.description || "");
  const initialOwners =
    group.owner_ids && group.owner_ids.length > 0
      ? group.owner_ids
      : group.owner_id
        ? [group.owner_id]
        : [];
  const isOwnerChanged =
    ownerIds.length !== initialOwners.length ||
    ownerIds.some((id, idx) => id !== initialOwners[idx]);
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
      if (isNameChanged || isDescChanged || isOwnerChanged) {
        updated = await api.patch<Group>(`/api/v1/groups/${group.id}`, {
          name: name.trim(),
          description: description.trim(),
          owner_ids: ownerIds,
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

  const allWorkspaceUsers = users
    .slice()
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
      email: u?.email || "",
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
    return (
      (m.full_name || m.username).toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      (m.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl"
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
            onClick={() => setActiveTab("usage")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "usage"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderKanban className="size-4" />
            Access grants{usage ? ` (${usage.spaces.length + usage.pages.length})` : ""}
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
        <div className="mt-4 h-120 min-h-120">
          {/* Tab 1: General Details */}
          {activeTab === "details" ? (
            <div className="space-y-4 pr-1 h-full overflow-visible pb-2">
              {/* Group Name & Description Section */}
              <div className="grid grid-cols-1 gap-3.5 bg-surface-sunken/40 border border-border p-3.5 rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-group-name" className="text-xs font-semibold">Group name</Label>
                    <span className="text-[10px] text-muted-foreground">Required</span>
                  </div>
                  <Input
                    id="edit-group-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Engineering, Product Leads..."
                    required
                    disabled={pending}
                    className="h-8.5 text-xs bg-background"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-group-description" className="text-xs font-semibold">Description</Label>
                  <textarea
                    id="edit-group-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of group purpose and team access scope..."
                    disabled={pending}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>

              {/* Group Owners Section */}
              <div className="border border-border rounded-lg p-3.5 bg-surface space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Crown className="size-3.5 text-amber-500" />
                      Group owners ({ownerIds.length})
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Owners can manage group details, add or remove members, and assign access permissions.
                    </p>
                  </div>
                </div>

                {/* Owner list badges */}
                <div className="flex flex-wrap gap-2 min-h-9 items-center p-2 rounded-md bg-background border border-border/70">
                  {ownerIds.map((id) => {
                    const u = users.find((user) => user.id === id);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1.5 py-1 px-2.5 rounded-md text-xs font-medium bg-surface border border-border shadow-xs text-foreground"
                      >
                        <span className="size-4 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold flex items-center justify-center">
                          {(u?.full_name || u?.username || id)[0]?.toUpperCase()}
                        </span>
                        <span className="truncate max-w-40 font-medium">{u?.full_name || u?.username || id}</span>
                        {ownerIds.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveOwner(id)}
                            className="hover:bg-danger/10 hover:text-danger text-muted-foreground p-0.5 rounded transition-colors cursor-pointer ml-0.5"
                            title="Remove owner"
                            disabled={pending}
                          >
                            <X className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Owner picker dropdown */}
                {availableOwners.length > 0 ? (
                  <div className="flex items-center gap-2 pt-1">
                    <SearchableUserPicker
                      users={availableOwners}
                      value=""
                      onChange={handleAddOwner}
                      disabled={pending}
                      side="top"
                      placeholder="+ Add another owner..."
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Tab 2: Members */}
          {activeTab === "members" ? (
            <div className="space-y-3 h-full flex flex-col min-h-0">
              {/* Sleek Single-Line Toolbar: Search Left + Add Member Right */}
              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                {/* Left: Compact Filter Search */}
                <div className="relative flex-1 min-w-44 max-w-xs">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                  <Input
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    placeholder="Search members..."
                    className="w-full pl-8 h-8 text-xs bg-background"
                  />
                </div>

                {/* Right: Add Member Control */}
                <div className="flex items-center gap-1.5 flex-1 min-w-56 justify-end">
                  <SearchableUserPicker
                    users={allWorkspaceUsers}
                    value={memberIdToAdd}
                    onChange={setMemberIdToAdd}
                    disabled={allWorkspaceUsers.length === 0}
                    addedUserIds={currentMemberUserIds}
                    placeholder="Select user to add..."
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs shrink-0 px-2.5"
                    onClick={handleStageAddMember}
                    disabled={!memberIdToAdd || pending}
                  >
                    <UserPlus className="size-3.5" />
                    Add
                  </Button>
                </div>
              </div>

              {/* Expansive Members List Table filling 100% of remaining space */}
              <div className="border-border flex-1 h-full min-h-0 overflow-y-auto rounded-lg border">
                {loadingMembers ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin mb-2" />
                    Loading members...
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No members found.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-surface-sunken text-muted-foreground sticky top-0">
                      <tr className="border-border border-b text-left">
                        <th className="px-3 py-2 font-medium">User</th>
                        <th className="px-3 py-2 font-medium">Username</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border divide-y">
                      {filteredMembers.map((member) => (
                        <tr
                          key={member.user_id}
                          className="hover:bg-surface-hover transition-colors"
                        >
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="bg-primary-subtle text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                                {(member.full_name || member.username)[0]?.toUpperCase()}
                              </span>
                              <span className="truncate font-medium text-foreground">
                                {member.full_name || member.username}
                              </span>
                              {member.isNew ? (
                                <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px] font-semibold tracking-wider uppercase">
                                  New
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                            @{member.username}
                          </td>
                          <td className="text-muted-foreground max-w-56 truncate px-3 py-2">
                            {member.email || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="hover:bg-danger-bg hover:text-danger text-muted-foreground h-7 px-2 text-xs"
                              onClick={() => handleStageRemoveMember(member.user_id)}
                              title="Remove member from group"
                            >
                              <UserMinus className="size-3.5" />
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}

          {/* Tab 3: Access grants - every Space/Page this group is
              currently granted access to, what `delete_group`'s
              `group_in_use` error refers to. */}
          {activeTab === "usage" ? (
            <div className="h-full overflow-y-auto pr-1 pb-2">
              <GroupUsagePanel
                group={group}
                usage={usage}
                loading={loadingUsage}
                onUsageChanged={handleUsageChanged}
              />
            </div>
          ) : null}

          {/* Tab 4: Global Permissions (Feature List with Toggle Switches) */}
          {activeTab === "permissions" ? (
            <div className="space-y-3 h-full flex flex-col min-h-0">
              <div className="bg-surface-sunken/50 border border-border p-3 rounded-lg flex items-start gap-2.5 shrink-0">
                <ShieldCheck className="size-4.5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-foreground">Workspace Global Access</p>
                  <p className="text-muted-foreground mt-0.5 leading-normal">
                    Administrative permissions enabled here apply to all members of this group across the entire workspace.
                  </p>
                </div>
              </div>

              <div className="border border-border rounded-lg flex-1 min-h-0 overflow-y-auto divide-y divide-border bg-surface">
                {(Object.keys(PERMISSION_CONFIG) as GlobalPermission[]).map((permission) => {
                  const config = PERMISSION_CONFIG[permission];
                  const Icon = config.icon;
                  const isEnabled = globalPermissions.includes(permission);

                  return (
                    <div
                      key={permission}
                      className={cn(
                        "flex items-center justify-between p-3 gap-3.5 transition-colors hover:bg-surface-hover",
                        isEnabled && "bg-primary-subtle/10",
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={cn(
                            "size-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors mt-0.5",
                            isEnabled
                              ? "bg-primary-subtle text-primary border-primary/30"
                              : "bg-muted/40 text-muted-foreground border-border/60",
                          )}
                        >
                          <Icon className="size-4" />
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{config.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.2 rounded border border-border/50">
                              {permission}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-normal">{config.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <Badge
                          variant={isEnabled ? "success" : "neutral"}
                          className="text-[10px] py-0.5 px-2 font-medium"
                        >
                          {isEnabled ? "Active" : "Disabled"}
                        </Badge>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={isEnabled}
                          onClick={() => handleTogglePermission(permission, !isEnabled)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                            isEnabled ? "bg-primary" : "bg-muted-foreground/30",
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                              isEnabled ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
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

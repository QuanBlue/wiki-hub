"use client";

import {
  Archive,
  ArchiveRestore,
  Check,
  Globe2,
  HardDrive,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { cn } from "@/lib/utils";
import type {
  Group,
  InstanceInfo,
  Space,
  SpacePermission,
  SpacePermissionAssignment,
  User,
} from "@/types/api";

const PERMISSIONS: [SpacePermission, string][] = [
  ["view", "View"],
  ["add", "Add"],
  ["delete", "Delete"],
  ["delete_own", "Delete own"],
  ["restrictions", "Restrictions"],
  ["export", "Export"],
  ["admin", "Admin"],
];

type TabKey = "general" | "access" | "danger";

// Groups the backend's Licensed-users count excludes because they already
// carry blanket admin access (see DEFAULT_ADMIN_GROUP_NAMES in the backend's
// SpaceService) - kept in sync with that list, not derived from it, since
// the frontend has no direct import path into the backend module.
const DEFAULT_ADMIN_GROUP_NAMES = new Set(["confluence-administrators"]);

function isDefaultGroup(g: Group) {
  return (
    g.name === "confluence-users" ||
    g.name === "confluence-administrators" ||
    g.name.toLowerCase().includes("default")
  );
}

function isDefaultUser(u: User) {
  return u.is_protected || u.username === "admin" || u.username === "sysadmin";
}

function EditSpaceModalContent({
  space,
  onOpenChange,
  initialUsers,
  initialGroups,
  onSpaceUpdated,
}: {
  space: Space;
  onOpenChange: (open: boolean) => void;
  initialUsers?: User[];
  initialGroups?: Group[];
  onSpaceUpdated?: () => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  // Initial & Draft States
  const [initialName, setInitialName] = useState(space.name);
  const [name, setName] = useState(space.name);

  const [initialVisibility, setInitialVisibility] = useState(space.visibility);
  const [visibility, setVisibility] = useState(space.visibility);

  // Blank means "follow the workspace". Kept as a string so clearing the
  // field is distinguishable from typing a 0.
  const spaceUploadLimit = (limit: number | null | undefined) =>
    limit ? String(limit) : "";
  const [initialUploadLimit, setInitialUploadLimit] = useState(
    spaceUploadLimit(space.max_upload_size_mb),
  );
  const [uploadLimit, setUploadLimit] = useState(
    spaceUploadLimit(space.max_upload_size_mb),
  );
  const [workspaceUploadLimitMb, setWorkspaceUploadLimitMb] = useState<number | null>(
    null,
  );

  const [groups, setGroups] = useState<Group[]>(initialGroups || []);
  const [users, setUsers] = useState<User[]>(initialUsers || []);

  const [initialAssignments, setInitialAssignments] = useState<SpacePermissionAssignment[]>([]);
  const [assignments, setAssignments] = useState<SpacePermissionAssignment[]>([]);

  const [groupIdToAdd, setGroupIdToAdd] = useState("");
  const [userIdToAdd, setUserIdToAdd] = useState("");
  const [pending, setPending] = useState(false);

  // Both permission tables open read-only - a stray click can't change
  // access until an administrator deliberately opts into editing one.
  const [groupsLocked, setGroupsLocked] = useState(true);
  const [usersLocked, setUsersLocked] = useState(true);

  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  async function loadSpacePermissions() {
    try {
      const [fetchedAssignments, fetchedGroups, rawUsersRes] = await Promise.all([
        api.get<SpacePermissionAssignment[]>(`/api/v1/spaces/${encodeURIComponent(space.key)}/permissions`),
        groups.length === 0 ? api.get<Group[]>("/api/v1/groups") : Promise.resolve(groups),
        users.length === 0 ? api.get<{ items?: User[] } | User[]>("/api/v1/users?limit=100") : Promise.resolve(users),
      ]);
      const fetchedUsers = Array.isArray(rawUsersRes)
        ? rawUsersRes
        : rawUsersRes.items || [];

      setInitialAssignments(fetchedAssignments);
      setAssignments(fetchedAssignments);
      if (groups.length === 0) setGroups(fetchedGroups);
      if (users.length === 0) setUsers(fetchedUsers);
    } catch {
      // Best-effort load
    }
  }

  useEffect(() => {
    setInitialName(space.name);
    setName(space.name);
    setInitialVisibility(space.visibility);
    setVisibility(space.visibility);
    setInitialUploadLimit(spaceUploadLimit(space.max_upload_size_mb));
    setUploadLimit(spaceUploadLimit(space.max_upload_size_mb));
    setActiveTab("general");
    setGroupsLocked(true);
    setUsersLocked(true);
    void loadSpacePermissions();
  }, [space.key, space.name, space.visibility, space.max_upload_size_mb]);

  // Only needed to show what "inherit" resolves to, so a failure is silent.
  useEffect(() => {
    let cancelled = false;
    api
      .get<InstanceInfo>("/api/v1/meta")
      .then((meta) => {
        if (!cancelled) {
          setWorkspaceUploadLimitMb(
            Math.round(meta.max_upload_size_bytes / (1024 * 1024)),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Calculate if there are unsaved changes
  const isGeneralChanged =
    visibility !== initialVisibility ||
    name.trim() !== initialName.trim() ||
    uploadLimit.trim() !== initialUploadLimit.trim();

  const isAssignmentsChanged = (() => {
    if (initialAssignments.length !== assignments.length) return true;
    const initialSet = new Set(
      initialAssignments.map((a) => `${a.principal_type}:${a.principal_id}:${[...a.permissions].sort().join(",")}`),
    );
    const currentSet = new Set(
      assignments.map((a) => `${a.principal_type}:${a.principal_id}:${[...a.permissions].sort().join(",")}`),
    );
    if (initialSet.size !== currentSet.size) return true;
    for (const val of currentSet) {
      if (!initialSet.has(val)) return true;
    }
    return false;
  })();

  const hasChanges = isGeneralChanged || isAssignmentsChanged;

  function handleAttemptClose() {
    if (hasChanges) {
      setUnsavedPromptOpen(true);
    } else {
      onOpenChange(false);
    }
  }

  async function handleSaveAll() {
    setPending(true);
    try {
      // 1. Update space properties if changed
      if (isGeneralChanged) {
        const trimmedLimit = uploadLimit.trim();
        await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, {
          name: name.trim() || space.name,
          visibility,
          max_upload_size_mb: trimmedLimit ? Number(trimmedLimit) : null,
        });
        setInitialVisibility(visibility);
        setInitialName(name);
        setInitialUploadLimit(trimmedLimit);
      }

      // 2. Compute assignment diffs
      const initialMap = new Map<string, Set<SpacePermission>>();
      for (const item of initialAssignments) {
        const key = `${item.principal_type}:${item.principal_id}`;
        initialMap.set(key, new Set(item.permissions));
      }

      const currentMap = new Map<string, Set<SpacePermission>>();
      for (const item of assignments) {
        const key = `${item.principal_type}:${item.principal_id}`;
        currentMap.set(key, new Set(item.permissions));
      }

      const requests: Promise<unknown>[] = [];

      // Diffs to add
      for (const [key, currentPerms] of currentMap.entries()) {
        const [principal_type, principal_id] = key.split(":");
        const initialPerms = initialMap.get(key) || new Set();

        for (const perm of currentPerms) {
          if (!initialPerms.has(perm)) {
            const endpoint = principal_type === "group" ? "groups" : "users";
            const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/${endpoint}/${principal_id}/${perm}`;
            requests.push(api.put(path));
          }
        }
      }

      // Diffs to remove
      for (const [key, initialPerms] of initialMap.entries()) {
        const [principal_type, principal_id] = key.split(":");
        const currentPerms = currentMap.get(key) || new Set();

        for (const perm of initialPerms) {
          if (!currentPerms.has(perm)) {
            const endpoint = principal_type === "group" ? "groups" : "users";
            const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/${endpoint}/${principal_id}/${perm}`;
            requests.push(api.delete(path));
          }
        }
      }

      await Promise.all(requests);
      toast.success("Space access & permissions saved.");
      setInitialAssignments(assignments);
      setGroupsLocked(true);
      setUsersLocked(true);
      onOpenChange(false);
      if (onSpaceUpdated) onSpaceUpdated();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not save space permissions.",
      );
    } finally {
      setPending(false);
    }
  }

  const assignedGroupIds = new Set(
    assignments
      .filter((a) => a.principal_type === "group")
      .map((a) => a.principal_id),
  );

  const assignedUserIds = new Set(
    assignments
      .filter((a) => a.principal_type === "user")
      .map((a) => a.principal_id),
  );

  // The confluence-administrators group already has full access everywhere
  // by default (see DEFAULT_ADMIN_GROUP_NAMES), so the Space directory table
  // never counts it - hide it here too unless it also holds a real per-space
  // grant, or the row count and the directory number drift apart.
  const displayedGroups = groups.filter(
    (g) => assignedGroupIds.has(g.id) && !DEFAULT_ADMIN_GROUP_NAMES.has(g.name.toLowerCase()),
  );

  // Superusers are excluded from the directory's Individual users *count*
  // for the same reason, but administrators still want to see who actually
  // holds full access to a space - so, unlike groups, a superuser with a
  // real grant here still shows as a row (flagged via isDefaultUser below).
  const displayedUsers = users.filter((u) => assignedUserIds.has(u.id));

  function hasGroupPermission(group: Group, permission: SpacePermission) {
    return assignments.some(
      (item) =>
        item.principal_type === "group" &&
        item.principal_id === group.id &&
        item.permissions.includes(permission),
    );
  }

  function toggleGroupPermission(group: Group, permission: SpacePermission, enabled: boolean) {
    setAssignments((current) => {
      const existing = current.find(
        (item) => item.principal_type === "group" && item.principal_id === group.id,
      );

      if (enabled) {
        if (existing) {
          return current.map((item) =>
            item.principal_type === "group" && item.principal_id === group.id
              ? {
                  ...item,
                  permissions: Array.from(new Set([...item.permissions, permission])),
                }
              : item,
          );
        }
        return [
          ...current,
          {
            space_id: space.id,
            principal_id: group.id,
            principal_type: "group",
            principal_name: group.name,
            permissions: [permission],
          },
        ];
      }

      if (!existing) return current;

      const nextPermissions = existing.permissions.filter((p) => p !== permission);
      if (nextPermissions.length === 0) {
        return current.filter(
          (item) => !(item.principal_type === "group" && item.principal_id === group.id),
        );
      }
      return current.map((item) =>
        item.principal_type === "group" && item.principal_id === group.id
          ? { ...item, permissions: nextPermissions }
          : item,
      );
    });
  }

  function handleAddGroup() {
    if (!groupIdToAdd) return;
    const targetGroup = groups.find((g) => g.id === groupIdToAdd);
    if (!targetGroup) return;
    toggleGroupPermission(targetGroup, "view", true);
    setGroupIdToAdd("");
  }

  function hasUserPermission(user: User, permission: SpacePermission) {
    return assignments.some(
      (item) =>
        item.principal_type === "user" &&
        item.principal_id === user.id &&
        item.permissions.includes(permission),
    );
  }

  function toggleUserPermission(user: User, permission: SpacePermission, enabled: boolean) {
    setAssignments((current) => {
      const existing = current.find(
        (item) => item.principal_type === "user" && item.principal_id === user.id,
      );

      if (enabled) {
        if (existing) {
          return current.map((item) =>
            item.principal_type === "user" && item.principal_id === user.id
              ? {
                  ...item,
                  permissions: Array.from(new Set([...item.permissions, permission])),
                }
              : item,
          );
        }
        return [
          ...current,
          {
            space_id: space.id,
            principal_id: user.id,
            principal_type: "user",
            principal_name: user.username,
            permissions: [permission],
          },
        ];
      }

      if (!existing) return current;

      const nextPermissions = existing.permissions.filter((p) => p !== permission);
      if (nextPermissions.length === 0) {
        return current.filter(
          (item) => !(item.principal_type === "user" && item.principal_id === user.id),
        );
      }
      return current.map((item) =>
        item.principal_type === "user" && item.principal_id === user.id
          ? { ...item, permissions: nextPermissions }
          : item,
      );
    });
  }

  function handleAddUser() {
    if (!userIdToAdd) return;
    const targetUser = users.find((u) => u.id === userIdToAdd);
    if (!targetUser) return;
    toggleUserPermission(targetUser, "view", true);
    setUserIdToAdd("");
  }

  async function handleToggleArchive() {
    setPending(true);
    const archiving = space.status === "active";
    try {
      await api.post<void>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/${archiving ? "archive" : "unarchive"}`,
      );
      toast.success(
        archiving ? `Archived space "${space.name}".` : `Restored space "${space.name}".`,
      );
      setConfirmArchiveOpen(false);
      onOpenChange(false);
      if (onSpaceUpdated) onSpaceUpdated();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not update this space.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleDeleteSpace() {
    setPending(true);
    try {
      await api.delete<void>(`/api/v1/spaces/${encodeURIComponent(space.key)}`);
      toast.success(`Deleted space "${space.name}".`);
      setConfirmDeleteOpen(false);
      onOpenChange(false);
      if (onSpaceUpdated) onSpaceUpdated();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not delete this space.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent
      className="max-w-3xl h-[80vh] max-h-[640px] flex flex-col p-6 overflow-hidden"
      title={`Edit space "${space.name}"`}
      description="Manage space permissions, visibility, archiving, and deletion."
      onPointerDownOutside={(e) => {
        if (hasChanges) {
          e.preventDefault();
          setUnsavedPromptOpen(true);
        }
      }}
      onEscapeKeyDown={(e) => {
        if (hasChanges) {
          e.preventDefault();
          setUnsavedPromptOpen(true);
        }
      }}
    >
      {/* Navigation Tabs - Fixed Header */}
      <div className="border-border border-b flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
            activeTab === "general"
              ? "border-primary text-foreground font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-4" />
          General
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("access")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
            activeTab === "access"
              ? "border-primary text-foreground font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <ShieldCheck className="size-4" />
          Access & Permissions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("danger")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
            activeTab === "danger"
              ? "border-primary text-foreground font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Trash2 className="size-4" />
          Space settings & Danger zone
        </button>
      </div>

      {/* Tab Content Container - Only this area scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-4 px-1.5 py-1 -mx-1.5">
        {/* Tab 0: General */}
        {activeTab === "general" ? (
          <div className="space-y-5">
            {/* Space Name */}
            <div className="space-y-1.5">
              <Label htmlFor="space-name" className="text-xs font-semibold">
                Space Name
              </Label>
              <Input
                id="space-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={space.name}
                className="text-sm"
                disabled={pending}
              />
            </div>

            {/* General Access Box */}
            <div className="border-border bg-surface rounded-lg border p-3.5 shadow-xs flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  {visibility === "open" ? (
                    <Globe2 className="size-3.5 text-primary" />
                  ) : (
                    <LockKeyhole className="size-3.5 text-muted-foreground" />
                  )}
                  General access
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Choose whether every signed-in user can view this Space.
                </p>
              </div>
              <Select
                value={visibility}
                onValueChange={(val) => setVisibility(val as "open" | "restricted")}
                disabled={pending}
              >
                <SelectTrigger className="w-36 h-8 text-xs bg-background">
                  <SelectValue>{visibility === "open" ? "Open" : "Restricted"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="restricted">Restricted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Attachment size limit */}
            <div className="border-border bg-surface flex items-center justify-between gap-3 rounded-lg border p-3.5 shadow-xs">
              <div>
                <Label
                  htmlFor="space-upload-limit"
                  className="text-foreground flex items-center gap-1.5 text-xs font-semibold"
                >
                  <HardDrive className="size-3.5 text-muted-foreground" />
                  Attachment size limit
                </Label>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {uploadLimit.trim()
                    ? "Applies to every upload into this Space."
                    : workspaceUploadLimitMb
                      ? `Leave blank to follow the workspace limit of ${workspaceUploadLimitMb} MB.`
                      : "Leave blank to follow the workspace limit."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Input
                  id="space-upload-limit"
                  type="number"
                  min={1}
                  max={10240}
                  inputMode="numeric"
                  value={uploadLimit}
                  onChange={(e) => setUploadLimit(e.target.value)}
                  placeholder={
                    workspaceUploadLimitMb ? String(workspaceUploadLimitMb) : "Inherited"
                  }
                  className="bg-background h-8 w-28 text-sm"
                  disabled={pending}
                />
                <span className="text-muted-foreground text-xs">MB</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tab 1: Access & Permissions */}
        {activeTab === "access" ? (
          <div className="space-y-5">
            {/* General Access Box */}
            <div className="border-border bg-surface rounded-lg border p-3.5 shadow-xs flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  {visibility === "open" ? (
                    <Globe2 className="size-3.5 text-primary" />
                  ) : (
                    <LockKeyhole className="size-3.5 text-muted-foreground" />
                  )}
                  General access
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Choose whether every signed-in user can view this Space.
                </p>
              </div>
              <Select
                value={visibility}
                onValueChange={(val) => setVisibility(val as "open" | "restricted")}
                disabled={pending}
              >
                <SelectTrigger className="w-36 h-8 text-xs bg-background">
                  <SelectValue>{visibility === "open" ? "Open" : "Restricted"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="restricted">Restricted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Group Permissions Table */}
            <div className="border-border bg-surface rounded-lg border shadow-xs overflow-hidden">
              <div className="border-border border-b p-3 flex items-center justify-between gap-2 bg-surface-sunken/40">
                {groupsLocked ? (
                  <p className="text-xs text-muted-foreground">
                    Group permissions are read-only. Edit to make changes.
                  </p>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Select value={groupIdToAdd} onValueChange={setGroupIdToAdd} disabled={groups.length === 0}>
                      <SelectTrigger className="h-8 text-xs bg-background flex-1">
                        <SelectValue placeholder="Add a group...">
                          {groups.find((g) => g.id === groupIdToAdd)?.name || "Add a group..."}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => {
                          const isAdded = assignedGroupIds.has(g.id);
                          const isDefault = isDefaultGroup(g);
                          return (
                            <SelectItem key={g.id} value={g.id} disabled={isAdded}>
                              <div className="flex items-center justify-between w-full gap-2">
                                <span>{g.name}</span>
                                {isAdded ? (
                                  <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                                    Added
                                  </Badge>
                                ) : isDefault ? (
                                  <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                                    Default
                                  </Badge>
                                ) : null}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs px-3 shrink-0"
                      onClick={handleAddGroup}
                      disabled={!groupIdToAdd || pending}
                    >
                      <Plus className="size-3.5" /> Add group
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-xs"
                  onClick={() => setGroupsLocked((current) => !current)}
                  disabled={pending}
                >
                  {groupsLocked ? <Pencil className="size-3.5" /> : <Check className="size-3.5" />}
                  {groupsLocked ? "Edit" : "Done"}
                </Button>
              </div>

              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                      <th className="px-3 py-2 font-medium">Group</th>
                      {PERMISSIONS.map(([, label]) => (
                        <th key={label} className="px-1.5 py-2 text-center font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedGroups.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-muted-foreground text-xs">
                          No groups added to this space yet.
                        </td>
                      </tr>
                    ) : (
                      displayedGroups.map((group) => {
                        const isDefault = isDefaultGroup(group);
                        return (
                          <tr key={group.id} className="hover:bg-surface-hover transition-colors">
                            <td className="px-3 py-2 font-medium text-foreground">
                              <span className="flex items-center gap-1.5">
                                <span>{group.name}</span>
                                {isDefault ? (
                                  <Badge variant="neutral" className="text-[10px] uppercase font-semibold py-0 px-1">
                                    Default
                                  </Badge>
                                ) : null}
                              </span>
                            </td>
                            {PERMISSIONS.map(([permission, label]) => (
                              <td key={permission} className="px-1.5 py-2 text-center">
                                <input
                                  type="checkbox"
                                  className="accent-primary size-3.5 rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`${group.name}: ${label}`}
                                  checked={hasGroupPermission(group, permission)}
                                  disabled={groupsLocked}
                                  onChange={(e) => toggleGroupPermission(group, permission, e.target.checked)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* User Permissions Table */}
            <div className="border-border bg-surface rounded-lg border shadow-xs overflow-hidden">
              <div className="border-border border-b p-3 flex items-center justify-between gap-2 bg-surface-sunken/40">
                {usersLocked ? (
                  <p className="text-xs text-muted-foreground">
                    Individual user permissions are read-only. Edit to make changes.
                  </p>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Select value={userIdToAdd} onValueChange={setUserIdToAdd} disabled={users.length === 0}>
                      <SelectTrigger className="h-8 text-xs bg-background flex-1">
                        <SelectValue placeholder="Add a user...">
                          {users.find((u) => u.id === userIdToAdd)?.full_name ||
                            users.find((u) => u.id === userIdToAdd)?.username ||
                            "Add a user..."}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => {
                          const isAdded = assignedUserIds.has(u.id);
                          const isAdmin = isDefaultUser(u);
                          return (
                            <SelectItem key={u.id} value={u.id} disabled={isAdded}>
                              <div className="flex items-center justify-between w-full gap-2">
                                <span>
                                  {u.full_name || u.username} (@{u.username})
                                </span>
                                {isAdded ? (
                                  <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                                    Added
                                  </Badge>
                                ) : isAdmin ? (
                                  <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                                    Admin
                                  </Badge>
                                ) : null}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs px-3 shrink-0"
                      onClick={handleAddUser}
                      disabled={!userIdToAdd || pending}
                    >
                      <Plus className="size-3.5" /> Add user
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-xs"
                  onClick={() => setUsersLocked((current) => !current)}
                  disabled={pending}
                >
                  {usersLocked ? <Pencil className="size-3.5" /> : <Check className="size-3.5" />}
                  {usersLocked ? "Edit" : "Done"}
                </Button>
              </div>

              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                      <th className="px-3 py-2 font-medium">User</th>
                      {PERMISSIONS.map(([, label]) => (
                        <th key={label} className="px-1.5 py-2 text-center font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-muted-foreground text-xs">
                          No users added to this space yet.
                        </td>
                      </tr>
                    ) : (
                      displayedUsers.map((user) => {
                        const isDefault = isDefaultUser(user);
                        return (
                          <tr key={user.id} className="hover:bg-surface-hover transition-colors">
                            <td className="px-3 py-2 font-medium text-foreground">
                              <span className="flex items-center gap-1.5">
                                <span>
                                  {user.full_name || user.username}{" "}
                                  <span className="text-muted-foreground font-normal">@{user.username}</span>
                                </span>
                                {isDefault ? (
                                  <Badge variant="neutral" className="text-[10px] uppercase font-semibold py-0 px-1">
                                    Default
                                  </Badge>
                                ) : null}
                              </span>
                            </td>
                            {PERMISSIONS.map(([permission, label]) => (
                              <td key={permission} className="px-1.5 py-2 text-center">
                                <input
                                  type="checkbox"
                                  className="accent-primary size-3.5 rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`${user.username}: ${label}`}
                                  checked={hasUserPermission(user, permission)}
                                  disabled={usersLocked}
                                  onChange={(e) => toggleUserPermission(user, permission, e.target.checked)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tab 2: Space settings & Danger zone */}
        {activeTab === "danger" ? (
          <div className="space-y-4">
            {/* Archive / Unarchive Card */}
            <div className="border border-border bg-surface rounded-lg p-4 space-y-3 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    {space.status === "active" ? (
                      <Archive className="size-4 text-amber-500" />
                    ) : (
                      <ArchiveRestore className="size-4 text-emerald-500" />
                    )}
                    {space.status === "active" ? "Archive space" : "Restore space"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-normal">
                    {space.status === "active"
                      ? "Archiving hides the space from normal navigation and browsing. Its pages and members remain intact, and administrators can restore it anytime."
                      : "Restoring this space will bring it back to active navigation and search lists."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={space.status === "active" ? "secondary" : "primary"}
                  size="sm"
                  className="shrink-0 h-8 text-xs"
                  onClick={() =>
                    space.status === "active" ? setConfirmArchiveOpen(true) : void handleToggleArchive()
                  }
                  disabled={pending}
                >
                  {space.status === "active" ? "Archive space" : "Restore space"}
                </Button>
              </div>
            </div>

            {/* Danger Zone: Delete Space Card */}
            <div className="border border-danger/30 bg-danger/5 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-danger flex items-center gap-1.5">
                    <Trash2 className="size-4 text-danger" />
                    Delete space permanently
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-normal">
                    This permanently removes space &quot;{space.name}&quot;, all of its pages, subpages, attachments, permissions, and history. This action cannot be undone.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="shrink-0 h-8 text-xs bg-danger hover:bg-danger/90 text-white"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={pending}
                >
                  Delete space
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Dialog Footer - Fixed Footer */}
      <DialogFooter className="pt-3 border-t border-border flex items-center justify-between shrink-0">
        <div className="text-xs text-muted-foreground">
          {hasChanges ? (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Unsaved changes
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleAttemptClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!hasChanges || pending}
            onClick={() => void handleSaveAll()}
          >
            {pending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </DialogFooter>

      {/* Confirmation Modals */}
      <ConfirmDialog
        open={confirmArchiveOpen}
        onOpenChange={setConfirmArchiveOpen}
        title={`Archive ${space.name}?`}
        description="This hides the space from normal navigation and browsing. Its pages and members remain unchanged, and an administrator can restore it later."
        confirmLabel="Archive space"
        pending={pending}
        onConfirm={() => void handleToggleArchive()}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${space.name}?`}
        description="This permanently removes the space, all its pages, memberships, and associated data. This action cannot be undone."
        confirmLabel="Delete space"
        destructive
        pending={pending}
        onConfirm={() => void handleDeleteSpace()}
      />

      {/* Unsaved Changes Confirmation Prompt Modal */}
      <Dialog open={unsavedPromptOpen} onOpenChange={setUnsavedPromptOpen}>
        <DialogContent
          className="max-w-md"
          title="Unsaved changes"
          description={`You have unsaved changes in Access & Permissions for space "${space.name}". What would you like to do?`}
        >
          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setUnsavedPromptOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="danger"
              className="w-full sm:w-auto bg-danger hover:bg-danger/90 text-white"
              onClick={() => {
                setAssignments(initialAssignments);
                setVisibility(initialVisibility);
                setGroupsLocked(true);
                setUsersLocked(true);
                setUnsavedPromptOpen(false);
                onOpenChange(false);
              }}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              variant="primary"
              className="w-full sm:w-auto"
              onClick={() => {
                setUnsavedPromptOpen(false);
                void handleSaveAll();
              }}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogContent>
  );
}

export function EditSpaceModal({
  space,
  open,
  onOpenChange,
  users,
  groups,
  onSpaceUpdated,
}: {
  space: Space | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users?: User[];
  groups?: Group[];
  onSpaceUpdated?: () => void;
}) {
  if (!space) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <EditSpaceModalContent
          key={`${space.id}-${open}`}
          space={space}
          onOpenChange={onOpenChange}
          initialUsers={users}
          initialGroups={groups}
          onSpaceUpdated={onSpaceUpdated}
        />
      ) : null}
    </Dialog>
  );
}

"use client";

import {
  Archive,
  ArchiveRestore,
  Globe2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
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

type TabKey = "access" | "danger";

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
  const [activeTab, setActiveTab] = useState<TabKey>("access");

  // Initial & Draft States
  const [initialVisibility, setInitialVisibility] = useState(space.visibility);
  const [visibility, setVisibility] = useState(space.visibility);

  const [groups, setGroups] = useState<Group[]>(initialGroups || []);
  const [users, setUsers] = useState<User[]>(initialUsers || []);

  const [initialAssignments, setInitialAssignments] = useState<SpacePermissionAssignment[]>([]);
  const [assignments, setAssignments] = useState<SpacePermissionAssignment[]>([]);

  const [groupIdToAdd, setGroupIdToAdd] = useState("");
  const [userIdToAdd, setUserIdToAdd] = useState("");
  const [pending, setPending] = useState(false);

  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  useEffect(() => {
    setInitialVisibility(space.visibility);
    setVisibility(space.visibility);
    setActiveTab("access");
    void loadSpacePermissions();
  }, [space.key]);

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

  // Calculate if there are unsaved changes
  const isVisibilityChanged = visibility !== initialVisibility;
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

  const hasChanges = isVisibilityChanged || isAssignmentsChanged;

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
      // 1. Update visibility if changed
      if (visibility !== initialVisibility) {
        await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, {
          visibility,
        });
        setInitialVisibility(visibility);
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

  const displayedGroups = groups.filter(
    (g) => assignedGroupIds.has(g.id) || isDefaultGroup(g),
  );

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
      <div className="flex-1 min-h-0 overflow-y-auto mt-4 pr-1">
        {/* Tab 1: Access & Permissions */}
        {activeTab === "access" ? (
          <div className="space-y-5 pr-1">
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
              <div className="border-border border-b p-3 flex items-center gap-2 bg-surface-sunken/40">
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
                  className="h-8 text-xs px-3"
                  onClick={handleAddGroup}
                  disabled={!groupIdToAdd || pending}
                >
                  <Plus className="size-3.5" /> Add group
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
                                  className="accent-primary size-3.5 cursor-pointer rounded border-border"
                                  aria-label={`${group.name}: ${label}`}
                                  checked={hasGroupPermission(group, permission)}
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
              <div className="border-border border-b p-3 flex items-center gap-2 bg-surface-sunken/40">
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
                  className="h-8 text-xs px-3"
                  onClick={handleAddUser}
                  disabled={!userIdToAdd || pending}
                >
                  <Plus className="size-3.5" /> Add user
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
                                  className="accent-primary size-3.5 cursor-pointer rounded border-border"
                                  aria-label={`${user.username}: ${label}`}
                                  checked={hasUserPermission(user, permission)}
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
          <div className="space-y-4 pr-1">
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

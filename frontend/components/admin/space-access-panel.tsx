"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { EffectiveSpacePermissions, Group, Space, SpacePermission, SpacePermissionAssignment, User } from "@/types/api";

// `export` is omitted here even though it's still a real `SpacePermission`
// value - it now follows View automatically (see `effective_permissions` in
// the backend's PermissionService) instead of being its own opt-in grant, so
// there is nothing left for a checkbox in this matrix to toggle.
const PERMISSIONS: [SpacePermission, string][] = [
  ["view", "View"], ["add", "Add/Edit"], ["delete", "Delete"], ["delete_own", "Delete own"],
  ["restrictions", "Restrictions"], ["move", "Move"], ["admin", "Admin"],
];

type PrincipalType = "group" | "user";
type DraftMap = Record<string, Set<SpacePermission>>;

function committedPermissions(
  assignments: SpacePermissionAssignment[],
  type: PrincipalType,
  principalId: string,
): Set<SpacePermission> {
  const set = new Set<SpacePermission>();
  for (const item of assignments) {
    if (item.principal_type === type && item.principal_id === principalId) {
      for (const permission of item.permissions) set.add(permission);
    }
  }
  return set;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Same-page-only left click on an internal link, the kind a route change starts from. */
function navigationTargetOf(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target && link.target !== "_self") return null;
  if (link.hasAttribute("download")) return null;
  const destination = new URL(link.href, window.location.href);
  if (destination.href === window.location.href) return null;
  return destination;
}

export function SpaceAccessPanel({ space, groups, users, initialAssignments }: { space: Space; groups: Group[]; users: User[]; initialAssignments: SpacePermissionAssignment[] }) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(space.visibility);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [visibilityPending, setVisibilityPending] = useState(false);

  const [groupEditing, setGroupEditing] = useState(false);
  const [groupDraft, setGroupDraft] = useState<DraftMap>({});
  const [groupId, setGroupId] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupExitConfirmOpen, setGroupExitConfirmOpen] = useState(false);

  const [userEditing, setUserEditing] = useState(false);
  const [userDraft, setUserDraft] = useState<DraftMap>({});
  const [userId, setUserId] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [userExitConfirmOpen, setUserExitConfirmOpen] = useState(false);

  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [leavePending, setLeavePending] = useState(false);

  const [effectiveUserId, setEffectiveUserId] = useState(users[0]?.id ?? "");
  const [effectivePermissions, setEffectivePermissions] = useState<EffectiveSpacePermissions | null>(null);
  const [effectivePermissionsUserId, setEffectivePermissionsUserId] = useState("");
  const [effectiveLoading, setEffectiveLoading] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the inspector loading state before its request resolves
    setEffectiveLoading(true);
    void api.get<EffectiveSpacePermissions>(`/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/effective/${effectiveUserId}`)
      .then((result) => {
        if (!cancelled) {
          setEffectivePermissions(result);
          setEffectivePermissionsUserId(effectiveUserId);
        }
      })
      .catch((error) => { if (!cancelled) toast.error(error instanceof ApiError ? error.message : "Could not load effective permissions."); })
      .finally(() => { if (!cancelled) setEffectiveLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveUserId, space.key]);

  const visibleEffectivePermissions = effectivePermissionsUserId === effectiveUserId
    ? effectivePermissions
    : null;

  // Dirty checks compare the in-progress draft against the last-saved assignments.
  const groupDirty = groupEditing && groups.some(
    (group) => !setsEqual(groupDraft[group.id] ?? new Set(), committedPermissions(assignments, "group", group.id)),
  );
  const userDirty = userEditing && users.some(
    (user) => !setsEqual(userDraft[user.id] ?? new Set(), committedPermissions(assignments, "user", user.id)),
  );
  const hasUnsavedChanges = groupDirty || userDirty;

  // A tab close, refresh, or click on any other link while a section is
  // mid-edit with unsaved changes routes through the same "save, discard, or
  // stay" decision instead of silently losing the change.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const message = "You have unsaved permission changes. Leave without saving?";
    const confirmUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      const destination = navigationTargetOf(event);
      if (!destination) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(destination.href);
    };
    window.addEventListener("beforeunload", confirmUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", confirmUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [hasUnsavedChanges]);

  function navigateAfterLeave(href: string) {
    const destination = new URL(href, window.location.href);
    if (destination.origin === window.location.origin) {
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
    } else {
      window.location.assign(destination.href);
    }
  }

  async function setVisibilityValue(value: typeof visibility) {
    setVisibilityPending(true);
    try { await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, { visibility: value }); setVisibility(value); toast.success("Space visibility updated."); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not update visibility."); }
    finally { setVisibilityPending(false); }
  }

  // -- Groups: draft editing -------------------------------------------
  function startGroupEditing() {
    const draft: DraftMap = {};
    for (const group of groups) draft[group.id] = new Set(committedPermissions(assignments, "group", group.id));
    setGroupDraft(draft);
    setGroupEditing(true);
  }

  function setGroupDraftPermission(id: string, permission: SpacePermission, enabled: boolean) {
    setGroupDraft((current) => {
      const next = { ...current, [id]: new Set(current[id] ?? []) };
      if (enabled) next[id].add(permission); else next[id].delete(permission);
      return next;
    });
  }

  function addGroupToDraft() {
    if (!groupId) return;
    setGroupDraftPermission(groupId, "view", true);
    setGroupId("");
  }

  /** Unchecks every permission for one group at once - `commitGroupChanges`
   * then diffs that empty set against what's committed and issues a DELETE
   * per permission the group had, the same as unchecking each box by hand. */
  function clearGroupDraft(id: string) {
    setGroupDraft((current) => ({ ...current, [id]: new Set() }));
  }

  async function applyGroupPermission(group: Group, permission: SpacePermission, enabled: boolean) {
    const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/groups/${group.id}/${permission}`;
    if (enabled) await api.put(path); else await api.delete(path);
    setAssignments((current) => enabled
      ? [...current, { space_id: space.id, principal_id: group.id, principal_type: "group", principal_name: group.name, permissions: [permission] }]
      : current.filter((item) => !(item.principal_type === "group" && item.principal_id === group.id && item.permissions.includes(permission))));
  }

  async function commitGroupChanges(): Promise<void> {
    for (const group of groups) {
      const draftSet = groupDraft[group.id] ?? new Set<SpacePermission>();
      const committedSet = committedPermissions(assignments, "group", group.id);
      for (const [permission] of PERMISSIONS) {
        const now = draftSet.has(permission);
        if (now !== committedSet.has(permission)) await applyGroupPermission(group, permission, now);
      }
    }
  }

  async function saveGroupEditing() {
    setGroupSaving(true);
    try {
      await commitGroupChanges();
      toast.success("Group permissions updated.");
      setGroupEditing(false);
      setGroupExitConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save group permissions.");
    } finally {
      setGroupSaving(false);
    }
  }

  function discardGroupEditing() {
    setGroupEditing(false);
    setGroupDraft({});
    setGroupId("");
    setGroupExitConfirmOpen(false);
  }

  function requestStopGroupEditing() {
    if (!groupDirty) { discardGroupEditing(); return; }
    setGroupExitConfirmOpen(true);
  }

  function groupHasPermission(group: Group, permission: SpacePermission) {
    return groupEditing
      ? (groupDraft[group.id] ?? new Set()).has(permission)
      : committedPermissions(assignments, "group", group.id).has(permission);
  }

  // -- Individual users: draft editing ----------------------------------
  function startUserEditing() {
    const draft: DraftMap = {};
    for (const user of users) draft[user.id] = new Set(committedPermissions(assignments, "user", user.id));
    setUserDraft(draft);
    setUserEditing(true);
  }

  function setUserDraftPermission(id: string, permission: SpacePermission, enabled: boolean) {
    setUserDraft((current) => {
      const next = { ...current, [id]: new Set(current[id] ?? []) };
      if (enabled) next[id].add(permission); else next[id].delete(permission);
      return next;
    });
  }

  function addUserToDraft() {
    if (!userId) return;
    setUserDraftPermission(userId, "view", true);
    setUserId("");
  }

  /** Unchecks every permission for one user at once - `commitUserChanges`
   * then diffs that empty set against what's committed and issues a DELETE
   * per permission the user had, the same as unchecking each box by hand. */
  function clearUserDraft(id: string) {
    setUserDraft((current) => ({ ...current, [id]: new Set() }));
  }

  async function applyUserPermission(user: User, permission: SpacePermission, enabled: boolean) {
    const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/users/${user.id}/${permission}`;
    if (enabled) await api.put(path); else await api.delete(path);
    setAssignments((current) => enabled
      ? [...current, { space_id: space.id, principal_id: user.id, principal_type: "user", principal_name: user.username, permissions: [permission] }]
      : current.filter((item) => !(item.principal_type === "user" && item.principal_id === user.id && item.permissions.includes(permission))));
  }

  async function commitUserChanges(): Promise<void> {
    for (const user of users) {
      const draftSet = userDraft[user.id] ?? new Set<SpacePermission>();
      const committedSet = committedPermissions(assignments, "user", user.id);
      for (const [permission] of PERMISSIONS) {
        const now = draftSet.has(permission);
        if (now !== committedSet.has(permission)) await applyUserPermission(user, permission, now);
      }
    }
  }

  async function saveUserEditing() {
    setUserSaving(true);
    try {
      await commitUserChanges();
      toast.success("User permissions updated.");
      setUserEditing(false);
      setUserExitConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save user permissions.");
    } finally {
      setUserSaving(false);
    }
  }

  function discardUserEditing() {
    setUserEditing(false);
    setUserDraft({});
    setUserId("");
    setUserExitConfirmOpen(false);
  }

  function requestStopUserEditing() {
    if (!userDirty) { discardUserEditing(); return; }
    setUserExitConfirmOpen(true);
  }

  function userHasPermission(user: User, permission: SpacePermission) {
    return userEditing
      ? (userDraft[user.id] ?? new Set()).has(permission)
      : committedPermissions(assignments, "user", user.id).has(permission);
  }

  // -- Leaving the page with either section mid-edit ---------------------
  async function saveAndLeave() {
    setLeavePending(true);
    try {
      if (groupDirty) await commitGroupChanges();
      if (userDirty) await commitUserChanges();
      setGroupEditing(false);
      setUserEditing(false);
      const destinationHref = leaveHref;
      setLeaveHref(null);
      if (destinationHref) navigateAfterLeave(destinationHref);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save changes.");
    } finally {
      setLeavePending(false);
    }
  }

  function leaveWithoutSaving() {
    discardGroupEditing();
    discardUserEditing();
    const destinationHref = leaveHref;
    setLeaveHref(null);
    if (destinationHref) navigateAfterLeave(destinationHref);
  }

  return <div className="space-y-4">
    <div className="border-border bg-surface rounded-xl border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">General access</h3><p className="text-muted-foreground mt-1 text-sm">Choose whether every signed-in user can view this Space.</p></div><Select value={visibility} onValueChange={(value) => void setVisibilityValue(value as typeof visibility)} disabled={visibilityPending}><SelectTrigger className="w-auto min-w-36" aria-label="Space visibility"><SelectValue>{visibility === "open" ? "Open" : "Restricted"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="restricted">Restricted</SelectItem></SelectContent></Select></div>
    </div>

    <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-4">
        {groupEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SearchableSelect
              id="add-group-to-space-access"
              value={groupId}
              onValueChange={setGroupId}
              disabled={groups.length === 0}
              placeholder="Add a group"
              searchPlaceholder="Search groups…"
              emptyMessage="No matching group."
              triggerClassName="min-w-0 flex-1"
              items={groups.map((group) => ({ value: group.id, label: group.name }))}
            />
            <Button onClick={addGroupToDraft} disabled={!groupId}><Plus /> Add group</Button>
          </div>
        ) : (
          <div>
            <h3 className="font-medium">Groups</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">Space permissions granted to a group and everyone in it.</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {groupEditing ? (
            <>
              <Button variant="ghost" onClick={requestStopGroupEditing} disabled={groupSaving}>Cancel</Button>
              <Button onClick={() => void saveGroupEditing()} disabled={groupSaving || !groupDirty}>{groupSaving ? "Saving..." : "Save"}</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={startGroupEditing}><Pencil className="size-3.5" /> Edit</Button>
          )}
        </div>
      </div>
      <table className="w-full min-w-190 text-sm"><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-4 py-3 font-medium">Group</th>{PERMISSIONS.map(([, label]) => <th key={label} className="px-2 py-3 text-center font-medium">{label}</th>)}<th className="px-2 py-3 text-center font-medium"><span className="sr-only">Remove</span></th></tr></thead><tbody>{groups.map((group) => <tr key={group.id} className="border-border hover:bg-surface-hover border-b last:border-0"><td className="px-4 py-3 font-medium">{group.name}</td>{PERMISSIONS.map(([permission, label]) => <td key={permission} className="px-2 py-3 text-center"><input className="accent-primary size-4 rounded border-border focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40" type="checkbox" aria-label={`${group.name}: ${label}`} checked={groupHasPermission(group, permission)} disabled={!groupEditing} onChange={(event) => setGroupDraftPermission(group.id, permission, event.target.checked)} /></td>)}<td className="px-2 py-3 text-center">{groupEditing ? <button type="button" aria-label={`Remove ${group.name} from this space`} title="Remove" className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring inline-flex cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none" onClick={() => clearGroupDraft(group.id)}><Trash2 className="size-3.5" /></button> : null}</td></tr>)}</tbody></table>
    </div>

    <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-4">
        {userEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SearchableSelect
              id="add-user-to-space-access"
              value={userId}
              onValueChange={setUserId}
              disabled={users.length === 0}
              placeholder="Add a user"
              searchPlaceholder="Search users…"
              emptyMessage="No matching user."
              triggerClassName="min-w-0 flex-1"
              items={users.map((user) => ({
                value: user.id,
                label: `${user.full_name || user.username} (@${user.username})`,
                searchText: `${user.full_name ?? ""} ${user.username}`,
              }))}
            />
            <Button onClick={addUserToDraft} disabled={!userId}><Plus /> Add user</Button>
          </div>
        ) : (
          <div>
            <h3 className="font-medium">Individual users</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">Space permissions granted to one person directly.</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {userEditing ? (
            <>
              <Button variant="ghost" onClick={requestStopUserEditing} disabled={userSaving}>Cancel</Button>
              <Button onClick={() => void saveUserEditing()} disabled={userSaving || !userDirty}>{userSaving ? "Saving..." : "Save"}</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={startUserEditing}><Pencil className="size-3.5" /> Edit</Button>
          )}
        </div>
      </div>
      <table className="w-full min-w-190 text-sm"><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-4 py-3 font-medium">User</th>{PERMISSIONS.map(([, label]) => <th key={label} className="px-2 py-3 text-center font-medium">{label}</th>)}<th className="px-2 py-3 text-center font-medium"><span className="sr-only">Remove</span></th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-border hover:bg-surface-hover border-b last:border-0"><td className="px-4 py-3 font-medium">{user.full_name || user.username} <span className="text-muted-foreground">@{user.username}</span></td>{PERMISSIONS.map(([permission, label]) => <td key={permission} className="px-2 py-3 text-center"><input className="accent-primary size-4 rounded border-border focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40" type="checkbox" aria-label={`${user.username}: ${label}`} checked={userHasPermission(user, permission)} disabled={!userEditing} onChange={(event) => setUserDraftPermission(user.id, permission, event.target.checked)} /></td>)}<td className="px-2 py-3 text-center">{userEditing ? <button type="button" aria-label={`Remove ${user.username} from this space`} title="Remove" className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring inline-flex cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none" onClick={() => clearUserDraft(user.id)}><Trash2 className="size-3.5" /></button> : null}</td></tr>)}</tbody></table>
    </div>

    <div className="border-border bg-surface rounded-xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-medium">Effective permissions</h3><p className="text-muted-foreground mt-1 text-sm">Includes Open access, direct assignments, and all active group memberships.</p></div>
        <Select value={effectiveUserId} onValueChange={setEffectiveUserId} disabled={users.length === 0}>
          <SelectTrigger className="w-auto min-w-48" aria-label="Inspect effective permissions for user"><SelectValue placeholder="Choose a user">{users.find((user) => user.id === effectiveUserId)?.full_name || users.find((user) => user.id === effectiveUserId)?.username || "Choose a user"}</SelectValue></SelectTrigger>
          <SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.full_name || user.username} (@{user.username})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2">
        {effectiveLoading ? <span className="text-muted-foreground text-sm">Loading...</span> : visibleEffectivePermissions?.permissions.map((permission) => <Badge key={permission} variant="subtle">{(PERMISSIONS.find(([key]) => key === permission)?.[1] ?? permission.replaceAll("_", " ")).toLowerCase()}</Badge>)}
        {!effectiveLoading && visibleEffectivePermissions && visibleEffectivePermissions.permissions.length === 0 ? <span className="text-muted-foreground text-sm">No effective permissions.</span> : null}
      </div>
    </div>

    <ConfirmDialog
      open={groupExitConfirmOpen}
      onOpenChange={(open) => { if (!open) setGroupExitConfirmOpen(false); }}
      title="Save group permission changes?"
      description="You have unsaved changes to group permissions. Save them before you stop editing?"
      confirmLabel="Save"
      cancelLabel="Keep editing"
      secondaryLabel="Discard changes"
      onSecondary={discardGroupEditing}
      pending={groupSaving}
      onConfirm={() => void saveGroupEditing()}
    />

    <ConfirmDialog
      open={userExitConfirmOpen}
      onOpenChange={(open) => { if (!open) setUserExitConfirmOpen(false); }}
      title="Save user permission changes?"
      description="You have unsaved changes to individual user permissions. Save them before you stop editing?"
      confirmLabel="Save"
      cancelLabel="Keep editing"
      secondaryLabel="Discard changes"
      onSecondary={discardUserEditing}
      pending={userSaving}
      onConfirm={() => void saveUserEditing()}
    />

    <ConfirmDialog
      open={leaveHref !== null}
      onOpenChange={(open) => { if (!open) setLeaveHref(null); }}
      title="Save changes before leaving?"
      description="You have unsaved permission changes on this page. Save them before you leave?"
      confirmLabel="Save and leave"
      cancelLabel="Stay"
      secondaryLabel="Leave without saving"
      onSecondary={leaveWithoutSaving}
      pending={leavePending}
      onConfirm={() => void saveAndLeave()}
    />
  </div>;
}

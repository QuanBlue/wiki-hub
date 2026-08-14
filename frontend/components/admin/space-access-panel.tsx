"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { EffectiveSpacePermissions, Group, Space, SpacePermission, SpacePermissionAssignment, User } from "@/types/api";

const PERMISSIONS: [SpacePermission, string][] = [
  ["view", "View"], ["add", "Add"], ["delete", "Delete"], ["delete_own", "Delete own"],
  ["restrictions", "Restrictions"], ["export", "Export"], ["admin", "Admin"],
];

export function SpaceAccessPanel({ space, groups, users, initialAssignments }: { space: Space; groups: Group[]; users: User[]; initialAssignments: SpacePermissionAssignment[] }) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(space.visibility);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [groupId, setGroupId] = useState("");
  const [userId, setUserId] = useState("");
  const [effectiveUserId, setEffectiveUserId] = useState(users[0]?.id ?? "");
  const [effectivePermissions, setEffectivePermissions] = useState<EffectiveSpacePermissions | null>(null);
  const [effectivePermissionsUserId, setEffectivePermissionsUserId] = useState("");
  const [effectiveLoading, setEffectiveLoading] = useState(false);
  const [pending, setPending] = useState(false);

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

  async function setVisibilityValue(value: typeof visibility) {
    setPending(true);
    try { await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, { visibility: value }); setVisibility(value); toast.success("Space visibility updated."); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not update visibility."); }
    finally { setPending(false); }
  }

  function hasPermission(group: Group, permission: SpacePermission) {
    return assignments.some((item) => item.principal_type === "group" && item.principal_id === group.id && item.permissions.includes(permission));
  }

  async function toggle(group: Group, permission: SpacePermission, enabled: boolean) {
    const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/groups/${group.id}/${permission}`;
    try {
      if (enabled) await api.put(path); else await api.delete(path);
      setAssignments((current) => enabled
        ? [...current, { space_id: space.id, principal_id: group.id, principal_type: "group", principal_name: group.name, permissions: [permission] }]
        : current.filter((item) => !(item.principal_type === "group" && item.principal_id === group.id && item.permissions.includes(permission))));
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not update permission."); }
  }

  async function addGroup() {
    if (!groupId) return;
    await toggle(groups.find((group) => group.id === groupId)!, "view", true);
    setGroupId("");
    router.refresh();
  }

  async function toggleUser(user: User, permission: SpacePermission, enabled: boolean) {
    const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/permissions/users/${user.id}/${permission}`;
    try {
      if (enabled) await api.put(path); else await api.delete(path);
      setAssignments((current) => enabled
        ? [...current, { space_id: space.id, principal_id: user.id, principal_type: "user", principal_name: user.username, permissions: [permission] }]
        : current.filter((item) => !(item.principal_type === "user" && item.principal_id === user.id && item.permissions.includes(permission))));
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "Could not update permission."); }
  }

  async function addUser() {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    await toggleUser(user, "view", true);
    setUserId("");
    router.refresh();
  }

  function hasUserPermission(user: User, permission: SpacePermission) {
    return assignments.some((item) => item.principal_type === "user" && item.principal_id === user.id && item.permissions.includes(permission));
  }

  return <div className="space-y-4">
    <div className="border-border bg-surface rounded-xl border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">General access</h3><p className="text-muted-foreground mt-1 text-sm">Choose whether every signed-in user can view this Space.</p></div><Select value={visibility} onValueChange={(value) => void setVisibilityValue(value as typeof visibility)} disabled={pending}><SelectTrigger className="w-auto min-w-36" aria-label="Space visibility"><SelectValue>{visibility === "open" ? "Open" : "Restricted"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="restricted">Restricted</SelectItem></SelectContent></Select></div>
    </div>
    <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
      <div className="border-border flex items-center gap-2 border-b p-4"><Select value={groupId} onValueChange={setGroupId} disabled={groups.length === 0}><SelectTrigger className="min-w-0 flex-1" aria-label="Add a group"><SelectValue placeholder="Add a group">{groups.find((group) => group.id === groupId)?.name || "Add a group"}</SelectValue></SelectTrigger><SelectContent>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select><Button onClick={() => void addGroup()} disabled={!groupId}><Plus /> Add group</Button></div>
      <table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-4 py-3 font-medium">Group</th>{PERMISSIONS.map(([, label]) => <th key={label} className="px-2 py-3 text-center font-medium">{label}</th>)}</tr></thead><tbody>{groups.map((group) => <tr key={group.id} className="border-border hover:bg-surface-hover border-b last:border-0"><td className="px-4 py-3 font-medium">{group.name}</td>{PERMISSIONS.map(([permission, label]) => <td key={permission} className="px-2 py-3 text-center"><input className="accent-primary size-4 cursor-pointer rounded border-border focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none" type="checkbox" aria-label={`${group.name}: ${label}`} checked={hasPermission(group, permission)} onChange={(event) => void toggle(group, permission, event.target.checked)} /></td>)}</tr>)}</tbody></table>
    </div>
    <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
      <div className="border-border flex items-center gap-2 border-b p-4"><Select value={userId} onValueChange={setUserId} disabled={users.length === 0}><SelectTrigger className="min-w-0 flex-1" aria-label="Add a user"><SelectValue placeholder="Add a user">{users.find((user) => user.id === userId)?.full_name || users.find((user) => user.id === userId)?.username || "Add a user"}</SelectValue></SelectTrigger><SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.full_name || user.username} (@{user.username})</SelectItem>)}</SelectContent></Select><Button onClick={() => void addUser()} disabled={!userId}><Plus /> Add user</Button></div>
      <table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-4 py-3 font-medium">User</th>{PERMISSIONS.map(([, label]) => <th key={label} className="px-2 py-3 text-center font-medium">{label}</th>)}</tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-border hover:bg-surface-hover border-b last:border-0"><td className="px-4 py-3 font-medium">{user.full_name || user.username} <span className="text-muted-foreground">@{user.username}</span></td>{PERMISSIONS.map(([permission, label]) => <td key={permission} className="px-2 py-3 text-center"><input className="accent-primary size-4 cursor-pointer rounded border-border focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none" type="checkbox" aria-label={`${user.username}: ${label}`} checked={hasUserPermission(user, permission)} onChange={(event) => void toggleUser(user, permission, event.target.checked)} /></td>)}</tr>)}</tbody></table>
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
        {effectiveLoading ? <span className="text-muted-foreground text-sm">Loading...</span> : visibleEffectivePermissions?.permissions.map((permission) => <Badge key={permission} variant="subtle">{permission.replaceAll("_", " ")}</Badge>)}
        {!effectiveLoading && visibleEffectivePermissions && visibleEffectivePermissions.permissions.length === 0 ? <span className="text-muted-foreground text-sm">No effective permissions.</span> : null}
      </div>
    </div>
  </div>;
}

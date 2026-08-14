"use client";

import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { Group, SpaceMember, User, WikiPage } from "@/types/api";

type RestrictionPermission = "view" | "edit";
type Restriction = {
  page_id: string;
  principal_id: string;
  principal_type: "user" | "group";
  principal_name: string;
  permission: RestrictionPermission;
};

export function PageRestrictionsDialog({
  spaceKey,
  page,
  members,
  groups,
}: {
  spaceKey: string;
  page: WikiPage;
  members: SpaceMember[];
  groups: Group[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Restriction[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [availableGroups, setAvailableGroups] = useState<Group[]>(groups);
  const [principalType, setPrincipalType] = useState<"user" | "group">("user");
  const [principalId, setPrincipalId] = useState("");
  const [permission, setPermission] = useState<RestrictionPermission>("view");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);

  const principals = principalType === "user"
    ? (availableUsers.length > 0
      ? availableUsers.map((user) => ({ id: user.id, label: user.full_name || user.username }))
      : members.map((member) => ({ id: member.user_id, label: member.full_name || member.username })))
    : availableGroups.map((group) => ({ id: group.id, label: group.name }));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading state while the dialog fetches its principals
    setLoading(true);
    const pagePath = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}`;
    void Promise.all([
      api.get<Restriction[]>(`${pagePath}/restrictions`),
      api.get<User[]>(`${pagePath}/restrictions/principals/users`),
      api.get<Group[]>(`${pagePath}/restrictions/principals/groups`),
    ])
      .then(([nextRows, nextUsers, nextGroups]) => {
        if (!cancelled) {
          setRows(nextRows);
          setAvailableUsers(nextUsers);
          setAvailableGroups(nextGroups);
        }
      })
      .catch((error) => { if (!cancelled) toast.error(error instanceof ApiError ? error.message : "Could not load page restrictions."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, page.slug, spaceKey]);

  async function setRestriction(
    type: "user" | "group",
    id: string,
    nextPermission: RestrictionPermission,
    enabled: boolean,
  ) {
    const path = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}/restrictions/${type === "user" ? "users" : "groups"}/${id}/${nextPermission}`;
    setPending(true);
    try {
      if (enabled) await api.put(path); else await api.delete(path);
      setRows((current) => enabled
        ? [
            ...current.filter(
              (row) =>
                !(
                  row.principal_id === id &&
                  row.principal_type === type &&
                  row.permission === nextPermission
                ),
            ),
            {
              page_id: page.id,
              principal_id: id,
              principal_type: type,
              principal_name: principals.find((item) => item.id === id)?.label ?? id,
              permission: nextPermission,
            },
          ]
        : current.filter((row) => !(row.principal_id === id && row.principal_type === type && row.permission === nextPermission)));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update page restrictions.");
    } finally { setPending(false); }
  }

  async function addRestriction() {
    if (!principalId) return;
    await setRestriction(principalType, principalId, permission, true);
    setPrincipalId("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm"><Lock /> Page access</Button>
      </DialogTrigger>
      <DialogContent title="Page access" description={`Choose who can view or edit "${page.title}". View restrictions inherit to child pages.`} className="max-w-2xl">
        <div className="border-border bg-surface-sunken grid gap-2 rounded-md border p-3 sm:grid-cols-[auto_1fr_auto_auto]">
          <Select
            value={principalType}
            onValueChange={(value) => {
              setPrincipalType(value as "user" | "group");
              setPrincipalId("");
            }}
            disabled={loading || pending}
          >
            <SelectTrigger aria-label="Principal type">
              <SelectValue>{principalType === "user" ? "User" : "Group"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="group">Group</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={principalId}
            onValueChange={setPrincipalId}
            disabled={loading || pending || principals.length === 0}
          >
            <SelectTrigger className="min-w-0" aria-label="Principal">
              <SelectValue placeholder={`Choose ${principalType}`}>
                {principals.find((item) => item.id === principalId)?.label ?? `Choose ${principalType}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {principals.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={permission}
            onValueChange={(value) => setPermission(value as RestrictionPermission)}
            disabled={loading || pending}
          >
            <SelectTrigger aria-label="Restriction permission">
              <SelectValue>{permission === "view" ? "Can view" : "Can edit"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">Can view</SelectItem>
              <SelectItem value="edit">Can edit</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => void addRestriction()} disabled={!principalId || pending}><Plus /> Add</Button>
        </div>
        <div className="border-border mt-4 overflow-x-auto rounded-md border">
          {loading ? <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm"><Loader2 className="animate-spin" /> Loading restrictions...</div> : <table className="w-full text-sm"><thead><tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left"><th className="px-3 py-2 font-medium">Principal</th><th className="px-3 py-2 font-medium">Access</th><th className="px-3 py-2 text-right font-medium">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.principal_type}-${row.principal_id}-${row.permission}`} className="border-border border-b last:border-0"><td className="px-3 py-2">{row.principal_name}</td><td className="px-3 py-2">Can {row.permission}</td><td className="px-3 py-2 text-right"><Button variant="ghost" size="icon" onClick={() => void setRestriction(row.principal_type, row.principal_id, row.permission, false)} disabled={pending} aria-label={`Remove ${row.permission} restriction`}><Trash2 /></Button></td></tr>)}{rows.length === 0 ? <tr><td colSpan={3} className="text-muted-foreground px-3 py-5 text-center">No page restrictions. The page follows Space access.</td></tr> : null}</tbody></table>}
        </div>
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

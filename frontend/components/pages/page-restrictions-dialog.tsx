"use client";

import { Check, Globe2, Info, Loader2, LockKeyhole, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type {
  PageAccessRosterGroup,
  PageAccessRosterUser,
  PageRestrictionGroupOption,
  PageRestrictionUserOption,
  SpaceMember,
  WikiPage,
} from "@/types/api";

/** Shown on a roster row's locked View/Edit checkboxes when the principal
 * holds space Admin - `can_view_page`/`can_edit_page` bypass every
 * page-level restriction for one, so blocking them here would silently do
 * nothing. Locking the boxes (rather than leaving them clickable but inert)
 * keeps the UI from implying a block took effect when it didn't. */
const ADMIN_BYPASS_KEY = "restrictions.adminBypassTitle";

type RestrictionPermission = "view" | "edit";
type Restriction = {
  page_id: string;
  principal_id: string;
  principal_type: "user" | "group";
  principal_name: string;
  permission: RestrictionPermission;
};

/** One row per *principal* rather than per (principal, permission) pair -
 * View and Edit restrictions are independent allow-lists on the backend
 * (see `PermissionService.can_view_page`/`can_edit_page`), but showing them
 * as two separate rows per person read as duplicate entries with no way to
 * change one, only add another or delete one. Folding them into a single
 * row with two checkboxes - the same table shape `EditSpaceModal` uses for
 * its own View/Add/.../Admin columns - lets an existing grant be adjusted
 * in place. */
type PrincipalRow = {
  type: "user" | "group";
  id: string;
  name: string;
  view: boolean;
  edit: boolean;
};

/** A roster row, reduced to the shape the table below actually renders -
 * `viewLocked`/`editLocked` cover both users and groups the same way,
 * unlike the raw API types which spell them `view_locked`/`edit_locked`
 * and differ in their name field. */
type RosterRow = {
  id: string;
  name: string;
  view: boolean;
  edit: boolean;
  viewLocked: boolean;
  editLocked: boolean;
};

function groupByPrincipal(rows: Restriction[], type: "user" | "group"): PrincipalRow[] {
  const byKey = new Map<string, PrincipalRow>();
  for (const row of rows) {
    if (row.principal_type !== type) continue;
    const entry = byKey.get(row.principal_id) ?? {
      type,
      id: row.principal_id,
      name: row.principal_name,
      view: false,
      edit: false,
    };
    if (row.permission === "view") entry.view = true;
    else entry.edit = true;
    byKey.set(row.principal_id, entry);
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function PageRestrictionsDialog({
  spaceKey,
  page,
  members,
  open,
  onOpenChange: setOpen,
}: {
  spaceKey: string;
  page: WikiPage;
  members: SpaceMember[];
  /** Controlled, like `MovePageDialog`/`PageHistoryModal` - the caller owns
   * a separate trigger (its own menu item) and this state, rather than this
   * component cloning one. A `DropdownMenuItem` that both opens this dialog
   * *and* runs Radix's own item-select close would need `preventDefault()`
   * on that close to dodge a focus race, but doing so left the dropdown
   * "open" (just hidden behind this dialog's overlay) instead of actually
   * unmounting - so its own `MenuRoot` kept listening for the browser
   * window to blur, and alt-tabbing away and back closed that zombie menu,
   * which returned focus to its trigger, which this dialog's own
   * dismissable layer read as a focus-outside interaction and closed on. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  // The page's own General-access setting, not something derived from
  // `rows` below - the two are meant to vary independently now, so a
  // Restricted allow-list can sit dormant while the page is Open (and come
  // right back when switched back) instead of being wiped every time. See
  // the backend's `PermissionService` module docstring.
  const [isViewRestricted, setIsViewRestricted] = useState(page.is_restricted ?? false);
  const [rows, setRows] = useState<Restriction[]>([]);
  const [availableUsers, setAvailableUsers] = useState<PageRestrictionUserOption[]>([]);
  const [availableGroups, setAvailableGroups] = useState<PageRestrictionGroupOption[]>([]);
  const [rosterUsers, setRosterUsers] = useState<PageAccessRosterUser[]>([]);
  const [rosterGroups, setRosterGroups] = useState<PageAccessRosterGroup[]>([]);
  const [groupIdToAdd, setGroupIdToAdd] = useState("");
  const [userIdToAdd, setUserIdToAdd] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  // Bumped to force the data effect below to re-run without also changing
  // `isViewRestricted` - Reset doesn't switch modes, it just needs whatever
  // that mode's own view currently shows re-fetched.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Both tables open read-only, same as `EditSpaceModal`'s own Group/User
  // tables - a stray click can't change who has access to this page until
  // someone deliberately opts into editing one.
  const [groupsLocked, setGroupsLocked] = useState(true);
  const [usersLocked, setUsersLocked] = useState(true);

  const pagePath = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}`;

  // A principal picked from `availableUsers`/`availableGroups` - every
  // active user/group, not just ones this space already grants access to
  // (see `list_users_for_page_restriction_picker` on the backend) - or,
  // before that loads, `members` (space membership, which by definition
  // already has space access). Search must never make someone look like
  // they don't exist just because they haven't been added to the space
  // yet; `hasSpaceAccess` is what lets the row itself explain that instead.
  // Only used in Restricted mode - Open mode's roster below already lists
  // everyone eligible, with nothing to search or add.
  type PrincipalOption = { id: string; name: string; label: string; searchText: string; hasSpaceAccess: boolean };
  const userOptions: PrincipalOption[] = (
    availableUsers.length > 0
      ? availableUsers.map((user) => ({ id: user.id, name: user.full_name || user.username, username: user.username, hasSpaceAccess: user.has_space_access }))
      : members.map((member) => ({ id: member.user_id, name: member.full_name || member.username, username: member.username, hasSpaceAccess: true }))
  ).map(({ id, name, username, hasSpaceAccess }) => ({
    id,
    name,
    label: `${name} (@${username})`,
    searchText: `${name} ${username}`,
    hasSpaceAccess,
  }));
  const groupOptions: PrincipalOption[] = availableGroups.map((group) => ({
    id: group.id,
    name: group.name,
    label: group.name,
    searchText: group.name,
    hasSpaceAccess: group.has_space_access,
  }));

  const groupRows = useMemo(() => groupByPrincipal(rows, "group"), [rows]);
  const userRows = useMemo(() => groupByPrincipal(rows, "user"), [rows]);
  const assignedGroupIds = new Set(groupRows.map((row) => row.id));
  const assignedUserIds = new Set(userRows.map((row) => row.id));

  const rosterUserRows: RosterRow[] = rosterUsers
    .map((user) => ({
      id: user.id,
      name: user.full_name || user.username,
      view: user.view,
      edit: user.edit,
      viewLocked: user.view_locked,
      editLocked: user.edit_locked,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rosterGroupRows: RosterRow[] = rosterGroups
    .map((group) => ({
      id: group.id,
      name: group.name,
      view: group.view,
      edit: group.edit,
      viewLocked: group.view_locked,
      editLocked: group.edit_locked,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to the page's own value each time the dialog (re)opens
    setIsViewRestricted(page.is_restricted ?? false);
  }, [open, page.is_restricted]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading state while the dialog fetches its principals
    setLoading(true);
    setGroupsLocked(true);
    setUsersLocked(true);
    const request = isViewRestricted
      ? Promise.all([
          api.get<Restriction[]>(`${pagePath}/restrictions`),
          api.get<PageRestrictionUserOption[]>(`${pagePath}/restrictions/principals/users`),
          api.get<PageRestrictionGroupOption[]>(`${pagePath}/restrictions/principals/groups`),
        ]).then(([nextRows, nextUsers, nextGroups]) => {
          if (cancelled) return;
          setRows(nextRows);
          setAvailableUsers(nextUsers);
          setAvailableGroups(nextGroups);
        })
      : Promise.all([
          api.get<PageAccessRosterUser[]>(`${pagePath}/restrictions/roster/users`),
          api.get<PageAccessRosterGroup[]>(`${pagePath}/restrictions/roster/groups`),
        ]).then(([nextUsers, nextGroups]) => {
          if (cancelled) return;
          setRosterUsers(nextUsers);
          setRosterGroups(nextGroups);
        });
    request
      .catch((error) => { if (!cancelled) toast.error(error instanceof ApiError ? error.message : t("restrictions.loadError")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, isViewRestricted, reloadNonce, pagePath]);

  function pathFor(type: "user" | "group", id: string, perm: RestrictionPermission): string {
    const kind = type === "user" ? "users" : "groups";
    return `${pagePath}/restrictions/${kind}/${id}/${perm}`;
  }

  async function setRestriction(
    type: "user" | "group",
    id: string,
    nextPermission: RestrictionPermission,
    enabled: boolean,
    principalName?: string,
  ) {
    setPending(true);
    try {
      if (enabled) await api.put(pathFor(type, id, nextPermission));
      else await api.delete(pathFor(type, id, nextPermission));
      setRows((current) => {
        const name = principalName ?? current.find((row) => row.principal_id === id && row.principal_type === type)?.principal_name ?? id;
        let next = enabled
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
                principal_name: name,
                permission: nextPermission,
              },
            ]
          : current.filter((row) => !(row.principal_id === id && row.principal_type === type && row.permission === nextPermission));
        // Granting Edit implicitly grants View too on the backend (every
        // other page permission is useless without it, same rule as the
        // space permission matrix) - mirror that here so the row's View box
        // reads as checked without waiting on a reload.
        if (enabled && nextPermission === "edit" && !next.some((row) => row.principal_id === id && row.principal_type === type && row.permission === "view")) {
          next = [...next, { page_id: page.id, principal_id: id, principal_type: type, principal_name: name, permission: "view" }];
        }
        return next;
      });
      // Adding the first View grant is how a page becomes Restricted (see
      // `set_page_restriction` on the backend) - the breadcrumb padlock/globe
      // icon reads `currentPage.is_restricted`, a prop fetched once when the
      // page loaded, so a refresh keeps it in sync with what just happened here.
      if (nextPermission === "view" || (nextPermission === "edit" && enabled)) {
        if (enabled) setIsViewRestricted(true);
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("restrictions.updateError"));
    } finally {
      setPending(false);
    }
  }

  function handleAddGroup() {
    if (!groupIdToAdd) return;
    const name = groupOptions.find((option) => option.id === groupIdToAdd)?.name ?? groupIdToAdd;
    void setRestriction("group", groupIdToAdd, "view", true, name);
    setGroupIdToAdd("");
  }

  function handleAddUser() {
    if (!userIdToAdd) return;
    const name = userOptions.find((option) => option.id === userIdToAdd)?.name ?? userIdToAdd;
    void setRestriction("user", userIdToAdd, "view", true, name);
    setUserIdToAdd("");
  }

  /** Drops both View and Edit for one principal at once - the same end
   * state as unchecking both boxes, just in one action (matches the
   * remove button `EditSpaceModal` uses for its own rows). Edit first: the
   * backend refuses to remove View while Edit still exists (every other
   * permission is useless without it), so removing View first would 409. */
  async function removePrincipal(row: PrincipalRow) {
    if (row.edit) await setRestriction(row.type, row.id, "edit", false);
    if (row.view) await setRestriction(row.type, row.id, "view", false);
  }

  /** Open mode's per-principal block toggle - the counterpart to
   * `setRestriction` above, but for the roster table: checking a box clears
   * any block (falling back to whatever the principal's space role already
   * gives them), unchecking creates one. Refetches the roster afterward
   * rather than patching state locally, since blocking View also silently
   * drops Edit server-side (you can't edit what you can't view) and
   * duplicating that logic here would be one more place for it to drift. */
  async function setBlocked(type: "user" | "group", id: string, permission: RestrictionPermission, blocked: boolean) {
    setPending(true);
    try {
      const path = `${pathFor(type, id, permission)}/block`;
      if (blocked) await api.put(path);
      else await api.delete(path);
      setReloadNonce((value) => value + 1);
      if (permission === "view") router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("restrictions.accessUpdateError"));
    } finally {
      setPending(false);
    }
  }

  async function setMode(restricted: boolean) {
    setPending(true);
    try {
      await api.patch(`${pagePath}/restrictions/mode`, { restricted });
      setIsViewRestricted(restricted);
      router.refresh();
      if (restricted) {
        toast.info(t("restrictions.restrictHintToast"));
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("restrictions.accessUpdateError"));
    } finally {
      setPending(false);
    }
  }

  async function resetAccess() {
    setPending(true);
    try {
      await api.post(`${pagePath}/restrictions/reset`);
      toast.success(
        isViewRestricted
          ? t("restrictions.clearedAllowList", { title: page.title })
          : t("restrictions.clearedBlocks", { title: page.title }),
      );
      setConfirmResetOpen(false);
      setReloadNonce((value) => value + 1);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("restrictions.resetError"));
    } finally {
      setPending(false);
    }
  }

  function renderPrincipalTable(
    kind: "group" | "user",
    label: string,
    principalRows: PrincipalRow[],
    locked: boolean,
    setLocked: (locked: boolean) => void,
    idToAdd: string,
    setIdToAdd: (id: string) => void,
    onAdd: () => void,
    options: PrincipalOption[],
    assignedIds: Set<string>,
  ) {
    return (
      <div className="border-border bg-surface rounded-lg border shadow-xs overflow-hidden">
        <div className="border-border bg-surface-sunken/40 flex items-center justify-between gap-2 border-b p-3">
          {locked ? (
            <p className="text-muted-foreground text-xs">
              {t("restrictions.readOnlyHint", { label })}
            </p>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <SearchableSelect
                id={`add-${kind}-to-page`}
                value={idToAdd}
                onValueChange={setIdToAdd}
                disabled={options.length === 0 || pending}
                placeholder={kind === "user" ? t("restrictions.addUser") : t("restrictions.addGroup")}
                searchPlaceholder={kind === "user" ? t("restrictions.searchUsers") : t("restrictions.searchGroups")}
                emptyMessage={kind === "user" ? t("restrictions.noMatchingUser") : t("restrictions.noMatchingGroup")}
                triggerClassName="h-8 text-xs bg-background flex-1"
                items={options.map((option) => {
                  const isAdded = assignedIds.has(option.id);
                  // A principal missing space access still shows up when
                  // searched for - hiding them would read as "this person
                  // doesn't exist" - but stays disabled with the reason,
                  // since restricting the page to them would only lock
                  // them out at the space door regardless.
                  const badge = isAdded ? (
                    <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                      {t("restrictions.addedBadge")}
                    </Badge>
                  ) : !option.hasSpaceAccess ? (
                    <Badge variant="warning" className="text-[10px] px-1.5 py-0 font-normal">
                      {t("restrictions.notInSpaceBadge")}
                    </Badge>
                  ) : null;
                  return {
                    value: option.id,
                    label: option.label,
                    searchText: option.searchText,
                    disabled: isAdded || !option.hasSpaceAccess,
                    badge,
                  };
                })}
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={onAdd}
                disabled={!idToAdd || pending}
              >
                <Plus className="size-3.5" /> {t("restrictions.addKind", { kind })}
              </Button>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-xs"
            onClick={() => setLocked(!locked)}
            disabled={pending}
          >
            {locked ? <Pencil className="size-3.5" /> : <Check className="size-3.5" />}
            {locked ? t("restrictions.edit") : t("restrictions.done")}
          </Button>
        </div>

        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                <th className="px-3 py-2 font-medium">{label}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t("restrictions.columnView")}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t("restrictions.columnEdit")}</th>
                <th className="px-1.5 py-2 text-center font-medium"><span className="sr-only">{t("restrictions.removeSr")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {principalRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground p-4 text-center text-xs">
                    {t("restrictions.emptyPrincipal", {
                      noun: kind === "user" ? t("restrictions.usersNoun") : t("restrictions.groupsNoun"),
                    })}
                  </td>
                </tr>
              ) : (
                principalRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover transition-colors">
                    <td className="text-foreground px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5 cursor-pointer rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t("restrictions.canViewAria", { name: row.name })}
                        checked={row.view}
                        disabled
                        title={t("restrictions.viewIsFloorTitle")}
                      />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5 cursor-pointer rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t("restrictions.canEditAria", { name: row.name })}
                        checked={row.edit}
                        disabled={locked || pending}
                        onChange={(event) => void setRestriction(row.type, row.id, "edit", event.target.checked, row.name)}
                      />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      {locked ? null : (
                        <button
                          type="button"
                          aria-label={t("restrictions.removeNamedAria", { name: row.name })}
                          title={t("restrictions.removeSr")}
                          className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring inline-flex cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                          disabled={pending}
                          onClick={() => void removePrincipal(row)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderRosterTable(
    kind: "group" | "user",
    label: string,
    rosterRows: RosterRow[],
    locked: boolean,
    setLocked: (locked: boolean) => void,
  ) {
    return (
      <div className="border-border bg-surface rounded-lg border shadow-xs overflow-hidden">
        {/* Same locked/unlocked header shape as `renderPrincipalTable` below
            (and `EditSpaceModal`'s own tables) - checkboxes here can block
            someone's access just as easily as the allow-list table can grant
            it, so a stray click shouldn't be able to do that either. There's
            no add-principal step in this mode (the roster already lists
            everyone eligible), so unlocking only ever swaps the button. */}
        <div className="border-border bg-surface-sunken/40 flex items-center justify-between gap-2 border-b p-3">
          <p className="text-muted-foreground flex-1 text-xs">
            {locked
              ? t("restrictions.rosterLocked", {
                  kind:
                    kind === "user"
                      ? t("restrictions.usersNoun")
                      : t("restrictions.groupsNoun"),
                })
              : t("restrictions.rosterUnlocked", {
                  kind:
                    kind === "user"
                      ? t("restrictions.usersNoun")
                      : t("restrictions.groupsNoun"),
                })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-xs"
            onClick={() => setLocked(!locked)}
            disabled={pending}
          >
            {locked ? <Pencil className="size-3.5" /> : <Check className="size-3.5" />}
            {locked ? t("restrictions.edit") : t("restrictions.done")}
          </Button>
        </div>
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                <th className="px-3 py-2 font-medium">{label}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t("restrictions.columnView")}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t("restrictions.columnEdit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rosterRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-muted-foreground p-4 text-center text-xs">
                    {t("restrictions.emptyRoster", {
                      noun: kind === "user" ? t("restrictions.usersNoun") : t("restrictions.groupsNoun"),
                    })}
                  </td>
                </tr>
              ) : (
                rosterRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover transition-colors">
                    <td className="text-foreground px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5 cursor-pointer rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t("restrictions.canViewAria", { name: row.name })}
                        checked={row.view}
                        disabled={locked || pending || row.viewLocked}
                        title={row.viewLocked ? t(ADMIN_BYPASS_KEY) : undefined}
                        onChange={(event) => void setBlocked(kind, row.id, "view", !event.target.checked)}
                      />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      {/* Read-only here: Edit always follows View under Open
                          access (there is no separate "editor demoted to
                          viewer" block any more - see `set_page_permission_denial`
                          / `can_edit_page`, which already require View
                          first) - blocking View above is the only lever. */}
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5 cursor-pointer rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t("restrictions.canEditAria", { name: row.name })}
                        checked={row.edit}
                        disabled
                        title={
                          row.viewLocked
                            ? t(ADMIN_BYPASS_KEY)
                            : row.editLocked
                              ? t("restrictions.roleNoEditTitle")
                              : t("restrictions.editFollowsViewTitle")
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // The "?" tooltip trigger is the first focusable element in this
        // dialog - Radix's default open-autofocus would land keyboard focus
        // on it immediately, and a focused Radix Tooltip trigger shows its
        // tooltip right away, same as hovering it. That reads as the hint
        // "popping up on its own" instead of only on a deliberate hover.
        onOpenAutoFocus={(event) => event.preventDefault()}
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("restrictions.title")}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-help rounded-full focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={t("restrictions.whoCanBeAddedAria")}
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t("restrictions.whoCanBeAddedHint")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
        description={t("restrictions.description", { title: page.title })}
        className="max-w-2xl"
      >
        {/* General access, same box as EditSpaceModal's own - an actual
            Select rather than a status readout, since switching modes is a
            real, immediate action. It no longer discards anything either
            way: Restricted keeps whatever allow-list it last had, and Open
            keeps whatever per-principal blocks it last had, so flipping
            back and forth is free - Reset (below) is the deliberate,
            confirmed way to actually clear the mode you're currently in. */}
        <div className="border-border bg-surface flex items-center justify-between gap-3 rounded-lg border p-3.5 shadow-xs">
          <div>
            <h4 className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
              {isViewRestricted ? (
                <LockKeyhole className="text-muted-foreground size-3.5" />
              ) : (
                <Globe2 className="text-primary size-3.5" />
              )}
              {t("restrictions.generalAccess")}
            </h4>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {t("restrictions.generalAccessHint")}
            </p>
          </div>
          <Select
            value={isViewRestricted ? "restricted" : "open"}
            onValueChange={(value) => void setMode(value === "restricted")}
            disabled={pending || loading}
          >
            <SelectTrigger className="h-8 w-36 bg-background text-xs">
              <SelectValue>
                {isViewRestricted
                  ? t("restrictions.modeRestricted")
                  : t("restrictions.modeOpen")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t("restrictions.modeOpen")}</SelectItem>
              <SelectItem value="restricted">
                {t("restrictions.modeRestricted")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-muted-foreground mt-3 flex items-center gap-2 p-4 text-sm">
            <Loader2 className="animate-spin" /> {t("restrictions.loading")}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {isViewRestricted ? (
              <>
                {/* Anyone the space itself hasn't granted access to still
                    shows up in the search below, greyed out with "Not
                    added to space" - naming them here would restrict the
                    page to someone still locked out at the space door. The
                    "?" next to the dialog title explains that up front; the
                    disabled row is the in-context reminder for whoever
                    gets there without hovering it. */}
                {renderPrincipalTable(
                  "group",
                  t("restrictions.groupLabel"),
                  groupRows,
                  groupsLocked,
                  setGroupsLocked,
                  groupIdToAdd,
                  setGroupIdToAdd,
                  handleAddGroup,
                  groupOptions,
                  assignedGroupIds,
                )}
                {renderPrincipalTable(
                  "user",
                  t("restrictions.userLabel"),
                  userRows,
                  usersLocked,
                  setUsersLocked,
                  userIdToAdd,
                  setUserIdToAdd,
                  handleAddUser,
                  userOptions,
                  assignedUserIds,
                )}
              </>
            ) : (
              <>
                {renderRosterTable("group", t("restrictions.groupLabel"), rosterGroupRows, groupsLocked, setGroupsLocked)}
                {renderRosterTable("user", t("restrictions.userLabel"), rosterUserRows, usersLocked, setUsersLocked)}
              </>
            )}
          </div>
        )}
        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs"
            onClick={() => setConfirmResetOpen(true)}
            disabled={pending || loading}
          >
            <RotateCcw className="size-3.5" /> {t("restrictions.resetToDefault")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("restrictions.done")}</Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title={
          isViewRestricted
            ? t("restrictions.resetAllowListTitle")
            : t("restrictions.resetBlocksTitle")
        }
        description={
          isViewRestricted
            ? t("restrictions.resetAllowListDescription", { title: page.title })
            : t("restrictions.resetBlocksDescription", { title: page.title })
        }
        confirmLabel={t("restrictions.reset")}
        destructive
        pending={pending}
        onConfirm={() => void resetAccess()}
      />
    </Dialog>
  );
}

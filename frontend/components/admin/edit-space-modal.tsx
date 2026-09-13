"use client";

import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Crown,
  Globe2,
  HardDrive,
  LockKeyhole,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError, describeApiError } from "@/lib/api-client";
import { groupPermissionAssignments } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  Group,
  InstanceInfo,
  Me,
  Space,
  SpaceOwner,
  SpacePermission,
  SpacePermissionAssignment,
  User,
} from "@/types/api";

// `export` isn't listed here even though it's still a real `SpacePermission`
// value: it now follows View automatically (see `effective_permissions` in
// the backend's PermissionService) rather than being its own opt-in grant,
// so there is nothing left for a checkbox in this matrix to toggle.
const PERMISSIONS: [SpacePermission, string][] = [
  ["view", "View"],
  ["add", "Add/Edit"],
  ["delete", "Delete"],
  ["delete_own", "Delete own"],
  ["restrictions", "Restrictions"],
  ["move", "Move"],
  ["admin", "Admin"],
];

// One tooltip per permission column, shown on hover over its header label -
// what checking that box actually lets someone do, since the abbreviated
// column headers (esp. "Delete own", "Move") don't say that on their own.
const PERMISSION_DESCRIPTION: Record<SpacePermission, string> = {
  view: "See this space and open its pages.",
  add: "Create new pages and edit any existing page in this space.",
  delete: "Delete any page in this space, including ones created by others.",
  delete_own: "Delete only pages this person or group created themselves.",
  restrictions: "Restrict individual pages to specific people or groups.",
  export: "Export pages from this space - follows View, not its own grant.",
  move: "Move or reorder pages within this space's hierarchy.",
  admin: "Full control of this space's settings and permissions - implies every other permission here.",
};

// What an Open space (`visibility: "open"`) hands to *every* signed-in
// user automatically - mirrors the backend's `OPEN_SPACE_PERMISSIONS`
// (`effective_permissions` in PermissionService). A per-user/group row for
// one of these while Open is true but redundant: the table shows "All"
// there instead of a checkbox, since (un)checking it could not actually
// change anyone's access. `admin` and `restrictions` are never handed out
// for free in either mode, so they stay live checkboxes always - that is
// the only way anyone becomes a space Owner-equivalent Admin, or narrows
// who can restrict pages.
const OPEN_AUTO_PERMISSIONS = new Set<SpacePermission>([
  "view",
  "add",
  "delete",
  "delete_own",
  "move",
]);

const ALL_PERMISSION_KEYS: SpacePermission[] = PERMISSIONS.map(([permission]) => permission);

// Fixed per-column widths, each just wide enough for that column's own
// header label at `text-xs` without wrapping (so "Delete own"/"Restrictions"
// don't need more room than "View"/"Move" do). Needed because the header and
// body below live in two *separate* `<table>` elements (see
// `PermissionColGroup`) - the header sits above the scrollable body instead
// of inside it, so a native scrollbar never cuts across the header row. Two
// independent tables would otherwise be free to size their columns
// differently since each one auto-sizes from only its own content; a
// `<colgroup>` this same width is rendered into both, morphing their
// `table-layout: fixed` column grids into one that always lines up. The Name
// column gets no explicit width, so it takes whatever the table's own width
// leaves over after these - keep the sum well under a typical dialog's
// content width or Name has nothing left to size itself with.
const PERMISSION_COL_WIDTH: Record<SpacePermission, string> = {
  view: "52px",
  add: "66px",
  delete: "56px",
  delete_own: "76px",
  restrictions: "82px",
  export: "60px",
  move: "50px",
  admin: "56px",
};
const ROLE_COL_WIDTH = "64px";
const REMOVE_COL_WIDTH = "36px";

function PermissionColGroup({ visibility }: { visibility: "open" | "restricted" }) {
  if (visibility === "open") {
    return (
      <colgroup>
        <col />
        {PERMISSIONS.filter(([permission]) => OPEN_AUTO_PERMISSIONS.has(permission)).map(
          ([permission]) => (
            <col key={permission} style={{ width: PERMISSION_COL_WIDTH[permission] }} />
          ),
        )}
      </colgroup>
    );
  }
  return (
    <colgroup>
      <col />
      <col style={{ width: ROLE_COL_WIDTH }} />
      {PERMISSIONS.map(([permission]) => (
        <col key={permission} style={{ width: PERMISSION_COL_WIDTH[permission] }} />
      ))}
      <col style={{ width: REMOVE_COL_WIDTH }} />
    </colgroup>
  );
}

/** Applies one checkbox click to a principal's current permission set,
 * folding in the Admin<->everything-else relationship the backend also
 * enforces (Admin *is* every other permission, see `ALL_SPACE_PERMISSIONS`
 * in `PermissionService`):
 * - Checking Admin checks every other column too - a partial Admin grant
 *   would just be confusing to read back later.
 * - Unchecking any column while every column was checked (i.e. Admin was
 *   on) also unchecks Admin - it can no longer honestly claim "everything"
 *   once one box is missing. */
function nextPermissionsFor(
  current: SpacePermission[],
  permission: SpacePermission,
  enabled: boolean,
): SpacePermission[] {
  if (enabled) {
    if (permission === "admin") return [...ALL_PERMISSION_KEYS];
    return Array.from(new Set([...current, permission]));
  }

  const hadEverything = ALL_PERMISSION_KEYS.every((p) => current.includes(p));
  let next = current.filter((p) => p !== permission);
  if (permission !== "admin" && hadEverything) {
    next = next.filter((p) => p !== "admin");
  }
  return next;
}

/** Same three-tier read as `PermissionService.role_of` on the backend,
 * derived client-side from one principal's checked columns for the "Role"
 * display column and its sort - there is no separate stored "role" for a
 * per-space grant, just the permission set itself. Owner is a fourth,
 * separate tier handled outside this function entirely (see `isOwnerRow`
 * below), since it isn't a function of the checkboxes at all. */
function principalRole(permissions: SpacePermission[]): "admin" | "editor" | "viewer" | "none" {
  if (permissions.includes("admin")) return "admin";
  if (permissions.includes("add")) return "editor";
  if (permissions.includes("view")) return "viewer";
  return "none";
}
const ROLE_SORT_WEIGHT: Record<ReturnType<typeof principalRole>, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
  none: 0,
};
const ROLE_LABEL: Record<ReturnType<typeof principalRole>, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  none: "—",
};

type SortKey = "name" | "role";
interface PrincipalSort {
  key: SortKey;
  dir: "asc" | "desc";
}
const DEFAULT_PRINCIPAL_SORT: PrincipalSort = { key: "name", dir: "asc" };

/** Clicking a not-yet-active sort key starts it at the direction that reads
 * naturally first - Name A→Z, but Role Admin-first (descending weight) -
 * clicking the already-active one just flips direction. */
function toggleSortKey(current: PrincipalSort, key: SortKey): PrincipalSort {
  if (current.key !== key) return { key, dir: key === "role" ? "desc" : "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/** One column header doubling as its own sort control - used for both the
 * Name column (the "Group"/"User" header itself) and the separate Role
 * column, so each stays a real, independently-aligned `<th>` rather than
 * being crammed together into one cell (which used to leave "Role" and the
 * actual role badges below it visually unaligned, since the name column's
 * width varies row to row). */
function SortableHeaderLabel({
  label,
  sortKey,
  sort,
  onSortChange,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: PrincipalSort;
  onSortChange: (next: PrincipalSort) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const icon = !active ? (
    <ArrowUpDown aria-hidden className="size-3 opacity-40" />
  ) : sort.dir === "asc" ? (
    <ArrowUp aria-hidden className="size-3" />
  ) : (
    <ArrowDown aria-hidden className="size-3" />
  );
  return (
    <button
      type="button"
      onClick={() => onSortChange(toggleSortKey(sort, sortKey))}
      className={cn("hover:text-foreground inline-flex items-center gap-1", className)}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      {icon}
    </button>
  );
}

/** A permission column's header label, hoverable for a one-line explanation
 * of what checking that box actually grants - the abbreviated headers
 * ("Delete own", "Move") don't say that on their own, and there's no room in
 * these narrow columns for a persistent caption. */
function PermissionHeaderLabel({ permission, label }: { permission: SpacePermission; label: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{PERMISSION_DESCRIPTION[permission]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type TabKey = "general" | "access" | "danger";

// Groups the backend's Licensed-users count excludes because they already
// carry blanket admin access (see DEFAULT_ADMIN_GROUP_NAMES in the backend's
// SpaceService) - kept in sync with that list, not derived from it, since
// the frontend has no direct import path into the backend module.
const DEFAULT_ADMIN_GROUP_NAMES = new Set(["confluence-administrators"]);

//: Mirrors the backend's rule (see `_check_name_start` in
//: `app/schemas/space.py`): a space name may not start with a digit or a
//: symbol, though any Unicode letter (including accented ones) is fine.
const NAME_START_PATTERN = /^\p{L}/u;
const NAME_ERROR = "Name must start with a letter, not a digit or special character.";

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

  // This space's protected administrators - see the backend's `SpaceOwner`.
  // Draft/initial split mirrors `EditGroupDialog`'s own owner picker: a
  // replace-all list, saved together with the rest of the General tab
  // rather than immediately on each add/remove.
  const [initialOwnerIds, setInitialOwnerIds] = useState<string[]>(
    space.owners.map((owner) => owner.user_id),
  );
  const [ownerIds, setOwnerIds] = useState<string[]>(initialOwnerIds);

  const [initialAssignments, setInitialAssignments] = useState<SpacePermissionAssignment[]>([]);
  const [assignments, setAssignments] = useState<SpacePermissionAssignment[]>([]);

  // Picking a group/user from either "Add a ..." box now grants `view`
  // immediately (see `handlePickGroup`/`handlePickUser`) - there is no
  // longer a separate "+ Add" step, so no draft selection to hold onto
  // between picking and confirming.
  //
  // Each list also remembers *the order things were just added in* here
  // (most recent first) purely for display: `displayedGroups`/
  // `displayedUsers` float these to the top of the table instead of
  // dropping them wherever the active sort would otherwise put them, so a
  // newly-granted row is never a scroll away from where it was just added.
  // `handleSaveAll` clears both once the save actually lands - after that,
  // the row is just another saved grant and sorts normally.
  const [recentGroupIds, setRecentGroupIds] = useState<string[]>([]);
  const [recentUserIds, setRecentUserIds] = useState<string[]>([]);
  const [groupSort, setGroupSort] = useState<PrincipalSort>(DEFAULT_PRINCIPAL_SORT);
  const [userSort, setUserSort] = useState<PrincipalSort>(DEFAULT_PRINCIPAL_SORT);
  const [pending, setPending] = useState(false);

  // Both permission tables open read-only - a stray click can't change
  // access until an administrator deliberately opts into editing one.
  const [groupsLocked, setGroupsLocked] = useState(true);
  const [usersLocked, setUsersLocked] = useState(true);

  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());

  async function loadSpacePermissions() {
    try {
      // These two "principals" endpoints are the same ones the admin Spaces
      // directory's own Access page uses (`listSpacePermissionGroups` /
      // `listSpacePermissionUsers` in lib/spaces.ts): unbounded (every
      // active user/group, not a single capped API page) and gated on
      // *this* space's admin permission rather than the site-wide
      // manage_users/manage_groups permission `/api/v1/users` and
      // `/api/v1/groups` require. Opening "Edit space" from within a space
      // (this modal's other entry point, unlike the directory, which
      // already passes a full list as props) previously fell back to those
      // global, 100-per-page-capped endpoints - silently omitting anyone
      // who sorted past the first page, and erroring out entirely for a
      // space admin who is not also a site admin.
      const spacePath = `/api/v1/spaces/${encodeURIComponent(space.key)}`;
      const [fetchedAssignments, fetchedGroups, fetchedUsers] = await Promise.all([
        api.get<SpacePermissionAssignment[]>(`${spacePath}/permissions`),
        groups.length === 0 ? api.get<Group[]>(`${spacePath}/permissions/principals/groups`) : Promise.resolve(groups),
        users.length === 0 ? api.get<User[]>(`${spacePath}/permissions/principals/users`) : Promise.resolve(users),
      ]);

      // The endpoint returns one row per (principal, permission) pair, not
      // one row per principal - fold them together before anything below
      // assumes a single combined `permissions` array per person/group.
      const groupedAssignments = groupPermissionAssignments(fetchedAssignments);
      setInitialAssignments(groupedAssignments);
      setAssignments(groupedAssignments);
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
    const nextOwnerIds = space.owners.map((owner) => owner.user_id);
    setInitialOwnerIds(nextOwnerIds);
    setOwnerIds(nextOwnerIds);
    setActiveTab("general");
    setGroupsLocked(true);
    setUsersLocked(true);
    void loadSpacePermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `space.owners` is a fresh array every render; keying off `space.key` (the only thing that identifies "a different space opened") avoids re-resetting the draft on every parent re-render.
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

  // Who is actually clicking, distinct from `space.is_owner` (whether they
  // are *an* Owner at all) - needed to single out their own chip below so
  // they can't remove themselves from the list (see `handleRemoveOwner`).
  // The httpOnly session cookie already rides along on this fetch, same as
  // every other `api.*` call in this component - no token handling needed.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<Me>("/api/v1/auth/me")
      .then((me) => {
        if (!cancelled) setCurrentUserId(me.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load other spaces' names to catch a duplicate before submit, rather
  // than surfacing it as a conflict only after the request round-trips.
  useEffect(() => {
    let cancelled = false;
    api
      .get<Space[]>("/api/v1/spaces", {
        query: { include_archived: true, limit: 200 },
      })
      .then((spaces) => {
        if (!cancelled) {
          setExistingNames(
            new Set(
              spaces
                .filter((other) => other.key !== space.key)
                .map((other) => other.name.trim().toLowerCase()),
            ),
          );
        }
      })
      .catch(() => {
        // Best-effort: if this fails, the duplicate check is simply skipped
        // and the backend's own conflict check still catches it on submit.
      });
    return () => {
      cancelled = true;
    };
  }, [space.key]);

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== initialName.trim();
  const isDuplicateName =
    !!trimmedName && existingNames.has(trimmedName.toLowerCase());
  // Only validate a name the user is actively changing - some existing
  // spaces predate this rule (e.g. imported names starting with a digit),
  // and re-litigating them on every unrelated save (visibility, upload
  // limit, ...) would lock those spaces out of edits entirely.
  const nameError = !trimmedName || !nameChanged
    ? null
    : !NAME_START_PATTERN.test(trimmedName)
      ? NAME_ERROR
      : isDuplicateName
        ? `A space named "${trimmedName}" already exists.`
        : null;

  const isOwnerChanged =
    ownerIds.length !== initialOwnerIds.length ||
    new Set(ownerIds).size !== new Set([...ownerIds, ...initialOwnerIds]).size;

  // Whether the current viewer is one of this space's Owners (or a system
  // administrator, who this component has no direct signal for and so is
  // not special-cased here). Gates both the Owner picker and the General
  // access (Open/Restricted) control below - an ordinary space Admin can
  // manage permissions but, per `SpaceService.update`, may not flip that
  // switch: doing so redefines what every other Admin grant even means.
  const isSpaceOwner = space.is_owner;
  const canManageOwners = isSpaceOwner;

  // Calculate if there are unsaved changes
  const isGeneralChanged =
    visibility !== initialVisibility ||
    name.trim() !== initialName.trim() ||
    uploadLimit.trim() !== initialUploadLimit.trim() ||
    isOwnerChanged;

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
    if (nameError) return;
    setPending(true);
    try {
      // 1. Update space properties if changed
      if (isGeneralChanged) {
        const trimmedLimit = uploadLimit.trim();
        await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, {
          // Only send a name when it actually changed - some existing
          // spaces predate the "must start with a letter" rule, and
          // resending their untouched name would fail that validation on
          // an otherwise-unrelated save (visibility, upload limit, ...).
          ...(nameChanged ? { name: trimmedName || space.name } : {}),
          visibility,
          max_upload_size_mb: trimmedLimit ? Number(trimmedLimit) : null,
        });
        setInitialVisibility(visibility);
        setInitialName(name);
        setInitialUploadLimit(trimmedLimit);
      }
      if (isOwnerChanged) {
        await api.put(`/api/v1/spaces/${encodeURIComponent(space.key)}/owners`, {
          owner_ids: ownerIds,
        });
        setInitialOwnerIds(ownerIds);
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
      // Once saved, a "just added" row is no different from any other - let
      // the active sort place it normally instead of still pinning it up top.
      setRecentGroupIds([]);
      setRecentUserIds([]);
      onOpenChange(false);
      if (onSpaceUpdated) onSpaceUpdated();
      router.refresh();
    } catch (error) {
      toast.error(describeApiError(error, "Could not save space permissions."));
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

  function groupPermissions(groupId: string): SpacePermission[] {
    return (
      assignments.find((a) => a.principal_type === "group" && a.principal_id === groupId)
        ?.permissions ?? []
    );
  }

  function userPermissions(userId: string): SpacePermission[] {
    return (
      assignments.find((a) => a.principal_type === "user" && a.principal_id === userId)
        ?.permissions ?? []
    );
  }

  // The confluence-administrators group already has full access everywhere
  // by default (see DEFAULT_ADMIN_GROUP_NAMES), so the Space directory table
  // never counts it - hide it here too unless it also holds a real per-space
  // grant, or the row count and the directory number drift apart.
  //
  // Ordering: whatever was just picked this session floats to the top
  // (most recent first, via `recentGroupIds`), then everything else follows
  // the active sort - by name, or by the role its permission set implies.
  const displayedGroups = useMemo(() => {
    const eligible = groups.filter(
      (g) => assignedGroupIds.has(g.id) && !DEFAULT_ADMIN_GROUP_NAMES.has(g.name.toLowerCase()),
    );
    const byId = new Map(eligible.map((g) => [g.id, g]));
    const recent = recentGroupIds
      .map((id) => byId.get(id))
      .filter((g): g is Group => g !== undefined);
    const recentIds = new Set(recent.map((g) => g.id));
    const rest = eligible.filter((g) => !recentIds.has(g.id));
    rest.sort((a, b) => {
      let base = 0;
      if (groupSort.key === "role") {
        base =
          ROLE_SORT_WEIGHT[principalRole(groupPermissions(a.id))] -
          ROLE_SORT_WEIGHT[principalRole(groupPermissions(b.id))];
      }
      if (base === 0) base = a.name.localeCompare(b.name);
      return groupSort.dir === "asc" ? base : -base;
    });
    return [...recent, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `groupPermissions` reads `assignments`, already a dependency below; adding the function itself would just churn on every render.
  }, [groups, assignedGroupIds, recentGroupIds, groupSort, assignments]);

  // Superusers are excluded from the directory's Individual users *count*
  // for the same reason, but administrators still want to see who actually
  // holds full access to a space - so, unlike groups, a superuser with a
  // real grant here still shows as a row (flagged via isDefaultUser below).
  //
  // An Owner (`ownerIds` - the draft General-tab list, so this reacts the
  // moment someone is added/removed there too) always shows here as well,
  // even with zero explicit grants of their own: their access does not come
  // from this table at all, but leaving them out of it would look like they
  // had none. Its row is rendered read-only regardless of Edit/Done (see
  // the `isOwnerRow` check below) since there is nothing here to actually
  // change for them.
  const displayedUsers = useMemo(() => {
    const eligible = users.filter((u) => assignedUserIds.has(u.id) || ownerIds.includes(u.id));
    const byId = new Map(eligible.map((u) => [u.id, u]));
    const recent = recentUserIds
      .map((id) => byId.get(id))
      .filter((u): u is User => u !== undefined);
    const recentIds = new Set(recent.map((u) => u.id));
    const rest = eligible.filter((u) => !recentIds.has(u.id));
    rest.sort((a, b) => {
      // An Owner outranks every computed role regardless of sort direction
      // intent for "role" - Owner is not a point on that scale, it is above
      // all of them - but still defers to Name sort like anyone else.
      const ownerDiff = Number(ownerIds.includes(b.id)) - Number(ownerIds.includes(a.id));
      if (userSort.key === "role" && ownerDiff !== 0) {
        return userSort.dir === "asc" ? -ownerDiff : ownerDiff;
      }
      let base = 0;
      if (userSort.key === "role") {
        base =
          ROLE_SORT_WEIGHT[principalRole(userPermissions(a.id))] -
          ROLE_SORT_WEIGHT[principalRole(userPermissions(b.id))];
      }
      if (base === 0) {
        base = (a.full_name || a.username).localeCompare(b.full_name || b.username);
      }
      return userSort.dir === "asc" ? base : -base;
    });
    return [...recent, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `userPermissions` reads `assignments`, already a dependency below; adding the function itself would just churn on every render.
  }, [users, assignedUserIds, ownerIds, recentUserIds, userSort, assignments]);

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

      const nextPermissions = nextPermissionsFor(existing?.permissions ?? [], permission, enabled);

      if (nextPermissions.length === 0) {
        return current.filter(
          (item) => !(item.principal_type === "group" && item.principal_id === group.id),
        );
      }
      if (existing) {
        return current.map((item) =>
          item.principal_type === "group" && item.principal_id === group.id
            ? { ...item, permissions: nextPermissions }
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
          permissions: nextPermissions,
        },
      ];
    });
  }

  function handleAddOwner(userId: string) {
    if (!userId || ownerIds.includes(userId)) return;
    setOwnerIds((current) => [...current, userId]);
  }

  function handleRemoveOwner(userId: string) {
    // The picker/UI already keeps this from firing at zero, but the
    // authoritative "at least one Owner" guard is the backend's - this is
    // just to stop the draft from ever visibly reaching an empty state.
    if (ownerIds.length <= 1) return;
    // Nor can anyone remove *themselves* here in one click, or remove a
    // system administrator - both chips already hide their own remove
    // button (below); this is just the matching backstop against firing
    // the action some other way (e.g. a future keyboard shortcut).
    if (userId === currentUserId) return;
    if (users.find((u) => u.id === userId)?.is_superuser) return;
    setOwnerIds((current) => current.filter((id) => id !== userId));
  }

  /** Picking a group from the "Add a group..." box grants `view` immediately
   * and floats the row to the top of the table (see `recentGroupIds`) -
   * there is no separate "+ Add" click any more. */
  function handlePickGroup(groupId: string) {
    const targetGroup = groups.find((g) => g.id === groupId);
    if (!targetGroup) return;
    toggleGroupPermission(targetGroup, "view", true);
    setRecentGroupIds((current) => [groupId, ...current.filter((id) => id !== groupId)]);
  }

  /** Drops every permission the group holds on this space at once - the
   * same end state as unchecking each of the seven columns individually,
   * just in one action. `handleSaveAll`'s diff against `initialAssignments`
   * turns this into one DELETE request per permission the group had. */
  function removeGroupAssignment(group: Group) {
    setAssignments((current) =>
      current.filter((item) => !(item.principal_type === "group" && item.principal_id === group.id)),
    );
    setRecentGroupIds((current) => current.filter((id) => id !== group.id));
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

      const nextPermissions = nextPermissionsFor(existing?.permissions ?? [], permission, enabled);

      if (nextPermissions.length === 0) {
        return current.filter(
          (item) => !(item.principal_type === "user" && item.principal_id === user.id),
        );
      }
      if (existing) {
        return current.map((item) =>
          item.principal_type === "user" && item.principal_id === user.id
            ? { ...item, permissions: nextPermissions }
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
          permissions: nextPermissions,
        },
      ];
    });
  }

  /** Picking a user from the "Add a user..." box grants `view` immediately
   * and floats the row to the top of the table (see `recentUserIds`) -
   * there is no separate "+ Add" click any more. */
  function handlePickUser(userId: string) {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return;
    toggleUserPermission(targetUser, "view", true);
    setRecentUserIds((current) => [userId, ...current.filter((id) => id !== userId)]);
  }

  /** Drops every permission the user holds on this space at once - the
   * same end state as unchecking each of the seven columns individually,
   * just in one action. `handleSaveAll`'s diff against `initialAssignments`
   * turns this into one DELETE request per permission the user had. */
  function removeUserAssignment(user: User) {
    setAssignments((current) =>
      current.filter((item) => !(item.principal_type === "user" && item.principal_id === user.id)),
    );
    setRecentUserIds((current) => current.filter((id) => id !== user.id));
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
              <div className="relative">
                <Input
                  id="space-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={space.name}
                  className="text-sm pr-9"
                  disabled={pending}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? "space-name-error" : undefined}
                />
                {trimmedName && nameChanged ? (
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
                    {nameError ? (
                      <XCircle className="text-danger size-4" aria-hidden />
                    ) : (
                      <CheckCircle2 className="text-success size-4" aria-hidden />
                    )}
                  </span>
                ) : null}
              </div>
              {nameError ? (
                <p id="space-name-error" className="text-danger text-[11px]">
                  {nameError}
                </p>
              ) : null}
            </div>

            {/* Space Owners - General access itself now lives only on the
                Access & Permissions tab, next to the permission tables it
                actually governs. */}
            <div className="border-border bg-surface rounded-lg border p-3.5 shadow-xs space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Crown className="size-3.5 text-primary" />
                  Space owner{ownerIds.length > 1 ? "s" : ""} ({ownerIds.length})
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Owners always have full administrator access, no matter what the
                  permission tables below say - a space always keeps at least one.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-9 items-center p-2 rounded-md bg-background border border-border/70">
                {ownerIds.map((id) => {
                  // `users` (the full principal list) has `is_superuser`;
                  // `space.owners` (the fallback, e.g. before that list has
                  // loaded) is just the lighter `SpaceOwner` shape and never
                  // needs to answer that - a superuser is always in `users`
                  // by the time this list can be edited at all.
                  const ownerAccount = users.find((u) => u.id === id);
                  const ownerUser = ownerAccount ?? space.owners.find((o) => o.user_id === id);
                  const label = ownerUser ? ownerUser.full_name || ownerUser.username : id;
                  const isSystemAdmin = ownerAccount?.is_superuser === true;
                  return (
                    <div
                      key={id}
                      className="border-border bg-surface text-foreground inline-flex items-center gap-1 rounded border py-0.5 pr-1 pl-1.5 text-[11px] font-medium"
                    >
                      <span className="truncate max-w-40">{label}</span>
                      {id === currentUserId ? (
                        <span className="text-muted-foreground text-[10px]" title="You can't remove yourself - have another Owner do it instead.">
                          (you)
                        </span>
                      ) : isSystemAdmin ? (
                        <span
                          className="text-muted-foreground text-[10px]"
                          title="A system administrator can't be removed as an Owner - they already have full access to every space regardless."
                        >
                          (system admin)
                        </span>
                      ) : canManageOwners && ownerIds.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveOwner(id)}
                          className="text-muted-foreground hover:text-danger hover:bg-danger-bg rounded p-0.5 transition-colors cursor-pointer"
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

              {canManageOwners ? (
                users.filter((u) => !ownerIds.includes(u.id)).length > 0 ? (
                  <SearchableSelect
                    id="add-space-owner"
                    value=""
                    onValueChange={handleAddOwner}
                    disabled={pending}
                    placeholder="+ Add another owner..."
                    searchPlaceholder="Search users…"
                    emptyMessage="No matching user."
                    triggerClassName="h-8 text-xs bg-background"
                    items={users
                      .filter((u) => !ownerIds.includes(u.id))
                      .map((u) => ({
                        value: u.id,
                        label: `${u.full_name || u.username} (@${u.username})`,
                        searchText: `${u.full_name ?? ""} ${u.username}`,
                      }))}
                  />
                ) : null
              ) : (
                <p className="text-muted-foreground text-[11px]">
                  Only a space Owner can change this list.
                </p>
              )}
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
                  {visibility === "open"
                    ? "Every signed-in user can view and edit this Space."
                    : "Only people granted access below can view or edit this Space."}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Only this space&apos;s Owner can change this - not even an Admin can.
                </p>
              </div>
              <Select
                value={visibility}
                onValueChange={(val) => setVisibility(val as "open" | "restricted")}
                disabled={pending || !isSpaceOwner}
              >
                <SelectTrigger
                  className="w-36 h-8 text-xs bg-background"
                  title={isSpaceOwner ? undefined : "Only this space's Owner can change its access mode."}
                >
                  <SelectValue>{visibility === "open" ? "Open" : "Restricted"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="restricted">Restricted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {visibility === "open" ? (
              <div className="border-warning/30 bg-warning-bg flex gap-2 rounded-md border p-2.5">
                <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" />
                <p className="text-xs">
                  <span className="font-medium">Every user can read and edit this Space.</span>{" "}
                  Switch to Restricted to grant View/Add/Delete/Move, Admin, or Restrictions to
                  specific people or groups - none of that can be set per person while Open.
                </p>
              </div>
            ) : null}

            {/* Group Permissions Table */}
            <div className="border-border bg-surface rounded-lg border shadow-xs overflow-hidden">
              <div className="border-border border-b p-3 flex items-center justify-between gap-2 bg-surface-sunken/40">
                {visibility === "open" ? (
                  <p className="text-xs text-muted-foreground">
                    Every group already has these permissions while this Space is Open.
                  </p>
                ) : groupsLocked ? (
                  <p className="text-xs text-muted-foreground">
                    Group permissions are read-only. Edit to make changes.
                  </p>
                ) : (
                  // Picking a name here grants `view` on the spot (see
                  // `handlePickGroup`) - there's no separate "+ Add" click,
                  // so a stray click can't leave a half-picked selection
                  // sitting in the box.
                  <SearchableSelect
                    id="add-group-to-space"
                    value=""
                    onValueChange={handlePickGroup}
                    disabled={groups.length === 0}
                    placeholder="Add a group..."
                    searchPlaceholder="Search groups…"
                    emptyMessage="No matching group."
                    triggerClassName="h-8 text-xs bg-background flex-1"
                    items={groups.map((g) => {
                      const isAdded = assignedGroupIds.has(g.id);
                      const isDefault = isDefaultGroup(g);
                      return {
                        value: g.id,
                        label: g.name,
                        disabled: isAdded,
                        badge: isAdded ? (
                          <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                            Added
                          </Badge>
                        ) : isDefault ? (
                          <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                            Default
                          </Badge>
                        ) : null,
                      };
                    })}
                  />
                )}
                {visibility === "open" ? null : (
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
                )}
              </div>

              {/* The header lives in its own, non-scrolling table above the
                  scrollable body table below - not inside the same
                  `overflow-y-auto` box the old single-table layout used -
                  so the body's scrollbar runs alongside only the rows, never
                  across the header. `table-fixed` plus the identical
                  `PermissionColGroup` in both tables is what keeps their
                  columns lined up despite being two separate elements. */}
              <table className="w-full table-fixed text-xs">
                <PermissionColGroup visibility={visibility} />
                <thead>
                  <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                    <th className="px-3 py-2 font-medium">
                      {visibility === "open" ? (
                        "Group"
                      ) : (
                        <SortableHeaderLabel
                          label="Group"
                          sortKey="name"
                          sort={groupSort}
                          onSortChange={setGroupSort}
                        />
                      )}
                    </th>
                    {visibility === "open" ? null : (
                      <th className="px-2 py-2 font-medium">
                        <SortableHeaderLabel
                          label="Role"
                          sortKey="role"
                          sort={groupSort}
                          onSortChange={setGroupSort}
                        />
                      </th>
                    )}
                    {(visibility === "open"
                      ? PERMISSIONS.filter(([permission]) => OPEN_AUTO_PERMISSIONS.has(permission))
                      : PERMISSIONS
                    ).map(([permission, label]) => (
                      <th key={label} className="px-1.5 py-2 text-center font-medium whitespace-nowrap">
                        <PermissionHeaderLabel permission={permission} label={label} />
                      </th>
                    ))}
                    {visibility === "open" ? null : (
                      <th className="px-1.5 py-2 text-center font-medium">
                        <span className="sr-only">Remove</span>
                      </th>
                    )}
                  </tr>
                </thead>
              </table>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full table-fixed text-xs">
                  <PermissionColGroup visibility={visibility} />
                  <tbody className="divide-y divide-border">
                    {visibility === "open" ? (
                      // Restrictions/Admin are never handed out for free, so
                      // they are the one thing an Open space still needs a
                      // real per-group row for - that's what Restricted mode
                      // (or the Space owner list on the General tab) is for.
                      // Naming every group here would just repeat the same
                      // "All" five times each; one summary row says it once.
                      <tr>
                        <td className="px-3 py-2 font-medium text-foreground">All groups</td>
                        {PERMISSIONS.filter(([permission]) => OPEN_AUTO_PERMISSIONS.has(permission)).map(
                          ([permission, label]) => (
                            <td key={permission} className="px-1.5 py-2 text-center">
                              <input
                                type="checkbox"
                                className="accent-primary size-3.5 rounded border-border disabled:cursor-not-allowed"
                                aria-label={`All groups: ${label}`}
                                checked
                                disabled
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ) : displayedGroups.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-4 text-center text-muted-foreground text-xs">
                          No groups added to this space yet.
                        </td>
                      </tr>
                    ) : (
                      displayedGroups.map((group) => {
                        const isDefault = isDefaultGroup(group);
                        const role = principalRole(groupPermissions(group.id));
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
                            <td className="text-muted-foreground px-2 py-2">{ROLE_LABEL[role]}</td>
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
                            <td className="px-1.5 py-2 text-center">
                              {groupsLocked ? null : (
                                <button
                                  type="button"
                                  aria-label={`Remove ${group.name} from this space`}
                                  title="Remove"
                                  className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring inline-flex cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                  onClick={() => removeGroupAssignment(group)}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              )}
                            </td>
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
                {visibility === "open" ? (
                  <p className="text-xs text-muted-foreground">
                    Every user already has these permissions while this Space is Open.
                  </p>
                ) : usersLocked ? (
                  <p className="text-xs text-muted-foreground">
                    Individual user permissions are read-only. Edit to make changes.
                  </p>
                ) : (
                  // Picking a name here grants `view` on the spot (see
                  // `handlePickUser`) - there's no separate "+ Add" click,
                  // so a stray click can't leave a half-picked selection
                  // sitting in the box.
                  <SearchableSelect
                    id="add-user-to-space"
                    value=""
                    onValueChange={handlePickUser}
                    disabled={users.length === 0}
                    placeholder="Add a user..."
                    searchPlaceholder="Search users…"
                    emptyMessage="No matching user."
                    triggerClassName="h-8 text-xs bg-background flex-1"
                    items={users.map((u) => {
                      const isAdded = assignedUserIds.has(u.id);
                      const isAdmin = isDefaultUser(u);
                      return {
                        value: u.id,
                        label: `${u.full_name || u.username} (@${u.username})`,
                        searchText: `${u.full_name ?? ""} ${u.username}`,
                        disabled: isAdded,
                        badge: isAdded ? (
                          <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                            Added
                          </Badge>
                        ) : isAdmin ? (
                          <Badge variant="neutral" className="text-[10px] text-muted-foreground px-1.5 py-0 font-normal">
                            Admin
                          </Badge>
                        ) : null,
                      };
                    })}
                  />
                )}
                {visibility === "open" ? null : (
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
                )}
              </div>

              {/* See the matching comment above the Group table - same
                  split-header/scrollable-body layout, same shared
                  `PermissionColGroup` keeping both tables' columns aligned. */}
              <table className="w-full table-fixed text-xs">
                <PermissionColGroup visibility={visibility} />
                <thead>
                  <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                    <th className="px-3 py-2 font-medium">
                      {visibility === "open" ? (
                        "User"
                      ) : (
                        <SortableHeaderLabel
                          label="User"
                          sortKey="name"
                          sort={userSort}
                          onSortChange={setUserSort}
                        />
                      )}
                    </th>
                    {visibility === "open" ? null : (
                      <th className="px-2 py-2 font-medium">
                        <SortableHeaderLabel
                          label="Role"
                          sortKey="role"
                          sort={userSort}
                          onSortChange={setUserSort}
                        />
                      </th>
                    )}
                    {(visibility === "open"
                      ? PERMISSIONS.filter(([permission]) => OPEN_AUTO_PERMISSIONS.has(permission))
                      : PERMISSIONS
                    ).map(([permission, label]) => (
                      <th key={label} className="px-1.5 py-2 text-center font-medium whitespace-nowrap">
                        <PermissionHeaderLabel permission={permission} label={label} />
                      </th>
                    ))}
                    {visibility === "open" ? null : (
                      <th className="px-1.5 py-2 text-center font-medium">
                        <span className="sr-only">Remove</span>
                      </th>
                    )}
                  </tr>
                </thead>
              </table>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full table-fixed text-xs">
                  <PermissionColGroup visibility={visibility} />
                  <tbody className="divide-y divide-border">
                    {visibility === "open" ? (
                      <tr>
                        <td className="px-3 py-2 font-medium text-foreground">All users</td>
                        {PERMISSIONS.filter(([permission]) => OPEN_AUTO_PERMISSIONS.has(permission)).map(
                          ([permission, label]) => (
                            <td key={permission} className="px-1.5 py-2 text-center">
                              <input
                                type="checkbox"
                                className="accent-primary size-3.5 rounded border-border disabled:cursor-not-allowed"
                                aria-label={`All users: ${label}`}
                                checked
                                disabled
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ) : displayedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-4 text-center text-muted-foreground text-xs">
                          No users added to this space yet.
                        </td>
                      </tr>
                    ) : (
                      displayedUsers.map((user) => {
                        const isDefault = isDefaultUser(user);
                        // An Owner's access never actually comes from this
                        // table (see `ownerIds` and `displayedUsers` above)
                        // - show every column checked and locked instead of
                        // whatever their real (possibly empty) grant is, so
                        // the row doesn't lie about what they can do, and
                        // isn't editable here since there is nothing this
                        // table could change for them anyway.
                        const isOwnerRow = ownerIds.includes(user.id);
                        const role = principalRole(userPermissions(user.id));
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
                            <td
                              className="text-muted-foreground px-2 py-2"
                              title={
                                isOwnerRow
                                  ? "Owners always have full access - manage this on the General tab instead."
                                  : undefined
                              }
                            >
                              {isOwnerRow ? "Owner" : ROLE_LABEL[role]}
                            </td>
                            {PERMISSIONS.map(([permission, label]) => (
                              <td key={permission} className="px-1.5 py-2 text-center">
                                <input
                                  type="checkbox"
                                  className="accent-primary size-3.5 rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`${user.username}: ${label}`}
                                  checked={isOwnerRow ? true : hasUserPermission(user, permission)}
                                  disabled={isOwnerRow || usersLocked}
                                  onChange={(e) => toggleUserPermission(user, permission, e.target.checked)}
                                />
                              </td>
                            ))}
                            <td className="px-1.5 py-2 text-center">
                              {usersLocked || isOwnerRow ? null : (
                                <button
                                  type="button"
                                  aria-label={`Remove ${user.username} from this space`}
                                  title="Remove"
                                  className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring inline-flex cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                  onClick={() => removeUserAssignment(user)}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              )}
                            </td>
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
            disabled={!hasChanges || pending || !!nameError}
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
                setName(initialName);
                setUploadLimit(initialUploadLimit);
                setOwnerIds(initialOwnerIds);
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

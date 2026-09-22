"use client";

import {
  Check,
  FolderKanban,
  Info,
  Loader2,
  Pencil,
  PlusCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { GlobalPermission, User, UserGroupMembership } from "@/types/api";

const LOWERCASE = "abcdefghjkmnpqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%*+-_";
const ALL_PASSWORD_CHARS = LOWERCASE + UPPERCASE + NUMBERS + SYMBOLS;
const PASSWORD_LENGTH = 20;

function randomCharacter(characters: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return characters[values[0]! % characters.length]!;
}

function generatePassword() {
  const password = [
    randomCharacter(LOWERCASE),
    randomCharacter(UPPERCASE),
    randomCharacter(NUMBERS),
    randomCharacter(SYMBOLS),
    ...Array.from({ length: PASSWORD_LENGTH - 4 }, () =>
      randomCharacter(ALL_PASSWORD_CHARS),
    ),
  ];
  return password
    .sort(() => {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0]! % 2 === 0 ? -1 : 1;
    })
    .join("");
}

/** Each rule doubles as a checklist row (label + met), not just a pass/fail -
 * see the "Passwords match" rule, which only makes sense once both fields
 * exist. Unlike `passwordRules` in `change-password-form.tsx`, an
 * administrator setting a password on someone else's behalf isn't held to
 * the app's strong-password shape (uppercase/lowercase/number) - only the
 * account owner changing their own password is. */
function passwordRules(password: string, confirmation: string) {
  return [
    {
      key: "length",
      label: "At least 8 characters",
      met: password.length >= 8,
    },
    {
      key: "match",
      label: "Passwords match",
      met: password.length > 0 && password === confirmation,
    },
  ];
}

/** An info icon next to a field label, for an explanation that would
 * otherwise be a permanent caption below the field - one whose visibility
 * used to depend on the field's current value, which meant the dialog's
 * height changed every time that value changed. Takes a node rather than a
 * plain string so a multi-option field (Role) can lay its explanation out as
 * a list instead of one run-on sentence. */
function FieldInfoTooltip({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex cursor-help items-center"
          >
            <Info className="size-3.5" />
            <span className="sr-only">More info</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** "inherit" = no override row (follow whatever the user's groups grant),
 * "enabled"/"disabled" = a row forcing that permission regardless of group. */
type OverrideChoice = "inherit" | "enabled" | "disabled";

type TabKey = "general" | "groups" | "access";

/**
 * The Groups tab: every group this account belongs to, each with a
 * one-click "Leave" - plus Select/Select-all for leaving several at once -
 * so clearing a stale membership doesn't mean going to find this account in
 * that group's own Members list instead. Mirrors the same select-mode /
 * bulk-action pattern `GroupUsagePanel` uses for Space/Page access grants.
 * Leaving is immediate, not staged behind this dialog's own Save button -
 * there is nothing to gain by deferring a removal that has no other field
 * here to conflict with.
 */
function GroupMembershipsPanel({
  userId,
  memberships,
  onMembershipsChanged,
  disabled,
  disabledTitle,
}: {
  userId: string;
  memberships: UserGroupMembership[];
  onMembershipsChanged: (next: UserGroupMembership[]) => void;
  disabled: boolean;
  disabledTitle?: string;
}) {
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [singleTarget, setSingleTarget] = useState<UserGroupMembership | null>(
    null,
  );
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  function toggleSelectMode() {
    setSelectMode((current) => {
      if (current) setSelected(new Set());
      return !current;
    });
  }
  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function leaveOne(group: UserGroupMembership) {
    setPendingId(group.id);
    try {
      await api.delete(`/api/v1/groups/${group.id}/members/${userId}`);
      onMembershipsChanged(memberships.filter((m) => m.id !== group.id));
      toast.success(`Left "${group.name}".`);
      setSingleTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : `Could not leave "${group.name}".`,
      );
    } finally {
      setPendingId(null);
    }
  }

  async function leaveSelected() {
    setBulkPending(true);
    const targets = memberships.filter((m) => selected.has(m.id));
    const leftIds: string[] = [];
    let failCount = 0;
    for (const group of targets) {
      try {
        await api.delete(`/api/v1/groups/${group.id}/members/${userId}`);
        leftIds.push(group.id);
      } catch {
        failCount += 1;
      }
    }
    setBulkPending(false);
    setBulkConfirmOpen(false);
    if (leftIds.length > 0) {
      onMembershipsChanged(memberships.filter((m) => !leftIds.includes(m.id)));
      toast.success(
        `Left ${leftIds.length} group${leftIds.length === 1 ? "" : "s"}.`,
      );
      router.refresh();
    }
    if (failCount > 0) {
      toast.error(
        `Could not leave ${failCount} group${failCount === 1 ? "" : "s"}.`,
      );
    }
    setSelected(new Set());
    setSelectMode(false);
  }

  if (memberships.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <div>
          <Users className="text-muted-foreground mx-auto mb-2 size-6" />
          <p className="text-foreground text-sm font-medium">
            Not a member of any group
          </p>
        </div>
      </div>
    );
  }

  const allSelected =
    memberships.length > 0 && memberships.every((m) => selected.has(m.id));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {memberships.length} group{memberships.length === 1 ? "" : "s"}
        </p>
        <Button
          type="button"
          size="sm"
          variant={selectMode ? "secondary" : "ghost"}
          onClick={toggleSelectMode}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
        >
          {selectMode
            ? `Cancel${selected.size ? ` (${selected.size})` : ""}`
            : "Select"}
        </Button>
      </div>

      {selectMode ? (
        <div className="bg-primary-subtle/30 border-border flex shrink-0 items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              className="border-border text-primary size-4 shrink-0 cursor-pointer rounded"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && !allSelected;
              }}
              onChange={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(memberships.map((m) => m.id)),
                )
              }
              aria-label="Select all groups"
            />
            <span className="font-medium">
              {selected.size > 0
                ? `${selected.size} selected`
                : `Select all (${memberships.length})`}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={selected.size === 0}
            >
              Leave selected
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border-border divide-border bg-surface min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
        {memberships.map((group) => (
          <div key={group.id} className="flex items-center gap-3 p-2.5">
            {selectMode ? (
              <input
                type="checkbox"
                className="border-border text-primary size-4 shrink-0 cursor-pointer rounded"
                checked={selected.has(group.id)}
                onChange={() => toggleOne(group.id)}
                aria-label={`Select ${group.name}`}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-xs font-medium">
                {group.name}
              </p>
            </div>
            {!selectMode ? (
              <button
                type="button"
                onClick={() => setSingleTarget(group)}
                disabled={disabled || pendingId !== null}
                title={disabled ? disabledTitle : `Leave "${group.name}"`}
                aria-label={`Leave "${group.name}"`}
                className="text-muted-foreground hover:bg-danger-bg hover:text-danger shrink-0 cursor-pointer rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <UserMinus className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={singleTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingId === null) setSingleTarget(null);
        }}
        title={singleTarget ? `Leave "${singleTarget.name}"?` : ""}
        description="This account loses whatever access that group granted them, unless another group or an override still covers it."
        confirmLabel="Leave group"
        destructive
        pending={pendingId !== null}
        onConfirm={() => {
          if (singleTarget) void leaveOne(singleTarget);
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !bulkPending) setBulkConfirmOpen(false);
        }}
        title={`Leave ${selected.size} group${selected.size === 1 ? "" : "s"}?`}
        description="This account loses whatever access those groups granted them, unless another group or an override still covers it."
        confirmLabel="Leave selected"
        destructive
        pending={bulkPending}
        onConfirm={() => void leaveSelected()}
      />
    </div>
  );
}

const PERMISSION_CONFIG: Record<
  GlobalPermission,
  {
    label: string;
    description: ReactNode;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  create_space: {
    label: "Create spaces",
    description: "Allows creating new documentation spaces in the workspace.",
    icon: PlusCircle,
  },
  manage_users: {
    label: "Manage users",
    description: (
      <div className="space-y-1.5">
        <p>
          Allows creating, editing, resetting passwords, and deactivating
          Member accounts.
        </p>
        <p>
          <strong className="text-foreground">Never</strong> promotes or
          demotes anyone, or touches an Administrator account - that always
          requires <strong className="text-foreground">System administrator</strong>.
        </p>
      </div>
    ),
    icon: Users,
  },
  manage_groups: {
    label: "Manage groups",
    description:
      "Allows creating, updating, assigning members, and managing user groups.",
    icon: FolderKanban,
  },
  system_admin: {
    label: "System administrator",
    description: (
      <div className="space-y-1.5">
        <p>
          Full administrative control over workspace settings, security, and
          system backups.
        </p>
        <p>
          Grants every other permission below too, from any source - forcing
          it on here (or setting{" "}
          <strong className="text-foreground">Role</strong> to{" "}
          <strong className="text-foreground">Administrator</strong>) does
          both at once: promotes the account and enables the rest. Turning it
          back off demotes the account and restores what was set before.
        </p>
      </div>
    ),
    icon: ShieldAlert,
  },
};
const PERMISSIONS = Object.keys(PERMISSION_CONFIG) as GlobalPermission[];
// System administrator sits above the other three in the Global Access tree
// below: per `has_global` on the backend, holding it from any source (Role,
// a group, or this account's own override) silently grants every other
// permission too, regardless of that permission's own setting - so it
// renders as the parent the other three nest under, not a sibling row.
const CHILD_PERMISSIONS = PERMISSIONS.filter(
  (permission) => permission !== "system_admin",
);

function overridesFromUser(
  user: User,
): Record<GlobalPermission, OverrideChoice> {
  const state = Object.fromEntries(
    PERMISSIONS.map((permission) => [permission, "inherit" as OverrideChoice]),
  ) as Record<GlobalPermission, OverrideChoice>;
  for (const row of user.global_permission_overrides) {
    state[row.permission] = row.enabled ? "enabled" : "disabled";
  }
  return state;
}

/**
 * Everything an administrator can change about another account, in one
 * place: role, active status, password, and per-permission overrides -
 * previously split across a "Reset password" dialog and two separate menu
 * actions (see the row actions this replaced).
 */
export function EditUserDialog({
  user,
  isSelf,
  viewerIsSystemAdmin,
  open,
  onOpenChange,
}: {
  user: User;
  isSelf: boolean;
  /** Whether the signed-in viewer is a System Administrator themselves
   * (`is_superuser`, or the `system_admin` global permission). `manage_users`
   * - whether from a Role, a group, or an override - lets someone create,
   * edit, deactivate, reset the password of and delete an ordinary Member,
   * but never change anyone's Role or Global Access overrides: those two
   * stay System-Administrator-only, since either can hand out power the
   * viewer may not themselves hold. See
   * `AuthService.assert_actor_is_system_admin` on the backend, which this
   * only mirrors for a clean disabled state instead of a 403 after Save. */
  viewerIsSystemAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [role, setRole] = useState(user.is_superuser ? "admin" : "member");
  const [statusValue, setStatusValue] = useState(
    user.is_active ? "active" : "disabled",
  );
  const [overrides, setOverrides] = useState<
    Record<GlobalPermission, OverrideChoice>
  >(() => overridesFromUser(user));
  // Snapshot of this account's overrides just before Role = Administrator or
  // a forced-enabled System administrator switched it into "full admin"
  // mode - restored verbatim if that gets undone in the same session, so
  // toggling admin on and back off is a no-op instead of losing whatever was
  // set before. Reset whenever the dialog re-seeds onto a (possibly
  // different) user below.
  const [preAdminOverrides, setPreAdminOverrides] = useState<Record<
    GlobalPermission,
    OverrideChoice
  > | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The row prop passed in is the People directory's own list data, which
  // never carries `group_memberships` or `global_permission_overrides` (see
  // the comment on `UserRead` in the backend) - only a single-user fetch
  // does. Without this, the Global Access tab always looked seeded with
  // "inherit from groups" on reopen even right after a successful save,
  // since it was reading a row that was never asked for the real answer.
  // `detail` starts as the (possibly stale) row prop so the dialog has
  // something to show immediately, then gets replaced once the fetch
  // resolves; the Groups tab's own Leave actions mutate it directly since
  // they are immediate, not staged behind this dialog's Save button.
  const [detail, setDetail] = useState<User>(user);
  const [loadingDetail, setLoadingDetail] = useState(false);

  function seedFieldsFrom(source: User) {
    setRole(source.is_superuser ? "admin" : "member");
    setStatusValue(source.is_active ? "active" : "disabled");
    setOverrides(overridesFromUser(source));
    setPreAdminOverrides(null);
  }

  async function loadFreshDetail(userId: string) {
    setLoadingDetail(true);
    try {
      const fresh = await api.get<User>(`/api/v1/users/${userId}`);
      setDetail(fresh);
      seedFieldsFrom(fresh);
    } catch {
      // Best-effort: the dialog stays usable on whatever the row prop
      // already seeded it with.
    } finally {
      setLoadingDetail(false);
    }
  }

  // Re-seed every field from the current row on the transition into "open"
  // (or onto a different user while already open) - this dialog is kept
  // mounted by its parent between opens, so state would otherwise leak
  // across rows. Tracked with refs rather than a plain `[open, user]`
  // dependency so a re-render that leaves both unchanged never re-seeds.
  const wasOpenRef = useRef(false);
  const previousUserIdRef = useRef(user.id);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    const switchedUser = open && user.id !== previousUserIdRef.current;
    wasOpenRef.current = open;
    previousUserIdRef.current = user.id;
    if (justOpened || switchedUser) {
      setActiveTab("general");
      setDetail(user);
      seedFieldsFrom(user);
      setPassword("");
      setConfirm("");
      setError(null);
      void loadFreshDetail(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loadFreshDetail`/`seedFieldsFrom` are redefined every render (not memoized); only `open`/`user` should ever re-trigger this seed.
  }, [open, user]);

  const initialRole = detail.is_superuser ? "admin" : "member";
  const initialStatus = detail.is_active ? "active" : "disabled";
  const initialOverrides = overridesFromUser(detail);

  const changingPassword = password.length > 0 || confirm.length > 0;
  const rules = passwordRules(password, confirm);
  // "Passwords match" is kept separate so a valid-but-not-yet-confirmed
  // password doesn't read as invalid before reaching the Confirm field.
  const passwordIsValid = rules[0]!.met;
  const passwordsMatch = rules[1]!.met;
  const mismatch = confirm.length > 0 && !passwordsMatch;
  // Rules read as muted (neither red nor green) until the operator actually
  // starts typing a new password - otherwise every row would open already
  // flagged red, which reads as an error before anyone has done anything.
  const passwordInteracted = passwordFocused || changingPassword;

  const overridesChanged = PERMISSIONS.some(
    (p) => overrides[p] !== initialOverrides[p],
  );
  const roleChanged = role !== initialRole;
  const statusChanged = statusValue !== initialStatus;
  const hasChanges =
    roleChanged || statusChanged || overridesChanged || changingPassword;

  // Live preview of what each permission would actually be if saved right
  // now - not just what's currently saved - so both the "Currently granted"
  // summary and each permission row's own Active/Disabled badge update the
  // instant Role or an override dropdown changes, instead of only after a
  // save-then-reopen round-trip. While the draft Role is Administrator,
  // every permission reads as granted outright, the same way it would once
  // actually saved; otherwise `inherit` falls back to what this account's
  // groups grant on their own (`global_permissions_from_groups`, since
  // `global_permissions` has already folded any *existing* override in and
  // cannot be un-mixed back apart), and `enabled`/`disabled` just pin it.
  const isAdminDraft = role === "admin";
  // Mirrors the backend's `has_global` shortcut (see `PermissionService`):
  // System administrator is the one permission that, once granted from any
  // source, silently unlocks every other one too - so the other three must
  // read as granted right alongside it (including when it only comes from a
  // group, per the account's `global_permissions_from_groups`), not just
  // once Role is literally Administrator.
  function isSystemAdminGranted(): boolean {
    if (isAdminDraft) return true;
    const choice = overrides.system_admin;
    if (choice === "enabled") return true;
    if (choice === "disabled") return false;
    return detail.global_permissions_from_groups.includes("system_admin");
  }
  const systemAdminEffective = isSystemAdminGranted();
  function isEffectivelyGranted(permission: GlobalPermission): boolean {
    if (permission === "system_admin") return systemAdminEffective;
    if (systemAdminEffective) return true;
    const choice = overrides[permission];
    if (choice === "enabled") return true;
    if (choice === "disabled") return false;
    return detail.global_permissions_from_groups.includes(permission);
  }
  const currentlyGranted = PERMISSIONS.filter(isEffectivelyGranted);

  /**
   * Flips this account between "full admin" and its previous state in one
   * step - Role = Administrator and System administrator = Force enabled
   * now imply each other. Turning admin ON promotes the Role, force-enables
   * every permission below, and snapshots whatever the overrides were a
   * moment ago; turning it OFF demotes the Role and restores those
   * overrides exactly (falling back to the account's actually-saved
   * overrides if this session never captured a snapshot - e.g. the dialog
   * opened on an existing Administrator being demoted without ever
   * toggling admin on first).
   */
  function applyAdminToggle(
    enable: boolean,
    finalSystemAdminChoice?: OverrideChoice,
  ) {
    if (enable) {
      setPreAdminOverrides(overrides);
      setRole("admin");
      setOverrides(
        Object.fromEntries(
          PERMISSIONS.map((permission) => [permission, "enabled"]),
        ) as Record<GlobalPermission, OverrideChoice>,
      );
    } else {
      setRole("member");
      const restored = preAdminOverrides ?? initialOverrides;
      setOverrides(
        finalSystemAdminChoice
          ? { ...restored, system_admin: finalSystemAdminChoice }
          : restored,
      );
      setPreAdminOverrides(null);
    }
  }

  function handleRoleChange(value: string) {
    if (value === "admin" && role !== "admin") applyAdminToggle(true);
    else if (value !== "admin" && role === "admin") applyAdminToggle(false);
    else setRole(value);
  }

  function handleSystemAdminChange(value: OverrideChoice) {
    const enabling = value === "enabled";
    if (enabling && role !== "admin") applyAdminToggle(true);
    else if (!enabling && role === "admin") applyAdminToggle(false, value);
    else setOverrides((current) => ({ ...current, system_admin: value }));
  }

  async function regeneratePassword() {
    const generated = generatePassword();
    setPassword(generated);
    setConfirm(generated);
    setError(null);
    try {
      await navigator.clipboard.writeText(generated);
      toast.success("A strong password was generated and copied to clipboard.");
    } catch {
      toast.success("A strong password was generated.");
      toast.error(
        "Could not copy it to the clipboard. Select it from the field instead.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changingPassword && (!passwordIsValid || !passwordsMatch)) {
      setError("The new password does not meet all requirements.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (roleChanged) patch.is_superuser = role === "admin";
      if (statusChanged) patch.is_active = statusValue === "active";
      if (overridesChanged) {
        const changedOverrides: Record<string, boolean | null> = {};
        for (const permission of PERMISSIONS) {
          if (overrides[permission] === initialOverrides[permission]) continue;
          changedOverrides[permission] =
            overrides[permission] === "inherit"
              ? null
              : overrides[permission] === "enabled";
        }
        patch.global_permission_overrides = changedOverrides;
      }
      if (Object.keys(patch).length > 0) {
        await api.patch<User>(`/api/v1/users/${user.id}`, patch);
      }
      if (changingPassword) {
        await api.post<User>(`/api/v1/users/${user.id}/password-reset`, {
          new_password: password,
        });
      }
      toast.success(`Changes saved for ${user.username}.`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save these changes.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (pending ? null : onOpenChange(next))}
    >
      <DialogContent
        className="max-w-2xl"
        title={`Edit ${user.username}`}
        description="Change this account's role, access, password, and permission overrides."
      >
        <div className="border-border -mt-1 flex items-center justify-between gap-2 border-b">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "general"
                  ? "border-primary text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Pencil className="size-4" />
              General
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("groups")}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "groups"
                  ? "border-primary text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Users className="size-4" />
              Groups ({detail.group_memberships.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("access")}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "access"
                  ? "border-primary text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <ShieldCheck className="size-4" />
              Global access
              {overridesChanged ? (
                <Badge variant="info" className="text-[10px]">
                  unsaved
                </Badge>
              ) : null}
            </button>
          </div>
          {loadingDetail ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 pr-1 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Refreshing...
            </span>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          {/* Fixed height, shared by both tabs - General and Global access
              hold very different amounts of content, and letting the dialog
              itself resize when switching between them reads as a jump.
              Whichever tab is shorter just leaves blank space below instead;
              longer content (e.g. General with the confirm-password field
              showing) scrolls internally. */}
          <div className="h-120 min-h-120 overflow-y-auto pr-1">
            {activeTab === "general" ? (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="edit-user-role">Role</Label>
                      <FieldInfoTooltip>
                        <ul className="list-disc space-y-1 pl-3.5">
                          <li>
                            <strong className="text-foreground">
                              Administrator
                            </strong>{" "}
                            can manage every user, space and setting.
                          </li>
                          <li>
                            <strong className="text-foreground">Member</strong>{" "}
                            has standard workspace access.
                          </li>
                          <li>
                            Only a System Administrator can change this. A{" "}
                            <strong className="text-foreground">
                              Manage users
                            </strong>{" "}
                            grant alone (a Role, a group, or an override) never
                            includes the power to promote or demote anyone -
                            it needs to actually be System Administrator.
                          </li>
                          <li>
                            Choosing{" "}
                            <strong className="text-foreground">
                              Administrator
                            </strong>{" "}
                            here does the same thing as forcing{" "}
                            <strong className="text-foreground">
                              System administrator
                            </strong>{" "}
                            on in the Global access tab, and vice versa.
                          </li>
                        </ul>
                      </FieldInfoTooltip>
                    </div>
                    <Select
                      value={role}
                      onValueChange={handleRoleChange}
                      disabled={pending || isSelf || !viewerIsSystemAdmin}
                    >
                      <SelectTrigger
                        id="edit-user-role"
                        aria-label="Role"
                        title={
                          isSelf
                            ? "You cannot change your own role."
                            : !viewerIsSystemAdmin
                              ? "Only a System Administrator can change a user's role."
                              : undefined
                        }
                      >
                        <SelectValue>
                          {role === "admin" ? "Administrator" : "Member"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Administrator</SelectItem>
                      </SelectContent>
                    </Select>
                    {!isAdminDraft && systemAdminEffective ? (
                      <p className="text-muted-foreground text-[11px]">
                        Already an effective admin via a group or override -
                        see the Global access tab.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="edit-user-status">Status</Label>
                      <FieldInfoTooltip>
                        A disabled account cannot sign in until it is
                        reactivated.
                      </FieldInfoTooltip>
                    </div>
                    <button
                      type="button"
                      id="edit-user-status"
                      role="switch"
                      aria-checked={statusValue === "active"}
                      aria-label="Status"
                      title={
                        isSelf
                          ? "You cannot deactivate your own account."
                          : undefined
                      }
                      onClick={() =>
                        setStatusValue(
                          statusValue === "active" ? "disabled" : "active",
                        )
                      }
                      disabled={pending || isSelf}
                      className="border-border bg-background flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                          statusValue === "active"
                            ? "bg-primary"
                            : "bg-muted-foreground/30",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                            statusValue === "active"
                              ? "translate-x-4"
                              : "translate-x-0",
                          )}
                        />
                      </span>
                      <span
                        className={cn(
                          "font-medium",
                          statusValue === "active"
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {statusValue === "active" ? "Active" : "Disabled"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="edit-user-password">New password</Label>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void regeneratePassword()}
                      disabled={pending}
                    >
                      <Sparkles />
                      Generate password
                    </Button>
                  </div>
                  <PasswordInput
                    id="edit-user-password"
                    autoComplete="new-password"
                    value={password}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={pending}
                    aria-invalid={
                      passwordFocused && changingPassword && !passwordIsValid
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    Leave both password fields blank to keep the current
                    password.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-user-confirm">
                    Confirm new password
                  </Label>
                  <PasswordInput
                    id="edit-user-confirm"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    disabled={pending}
                    aria-invalid={mismatch || undefined}
                  />
                </div>

                <ul className="space-y-1" aria-live="polite">
                  {rules.map((rule) => (
                    <li
                      key={rule.key}
                      className={cn(
                        "flex items-center gap-1.5 text-xs",
                        rule.met
                          ? "text-foreground"
                          : passwordInteracted
                            ? "text-danger"
                            : "text-muted-foreground",
                      )}
                    >
                      {rule.met ? (
                        <Check
                          className="text-success size-3.5 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <X
                          className={cn(
                            "size-3.5 shrink-0",
                            passwordInteracted
                              ? "text-danger"
                              : "text-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                      )}
                      {rule.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : activeTab === "groups" ? (
              <GroupMembershipsPanel
                userId={user.id}
                memberships={detail.group_memberships}
                onMembershipsChanged={(next) =>
                  setDetail((current) => ({
                    ...current,
                    group_memberships: next,
                  }))
                }
                disabled={isSelf}
                disabledTitle="You cannot leave your own groups from here."
              />
            ) : (
              <div className="space-y-2">
                <div className="bg-surface-sunken/50 border-border rounded-lg border p-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="text-primary size-4.5 shrink-0" />
                    <div className="flex items-center gap-1.5">
                      <p className="text-foreground text-xs font-semibold">
                        Workspace Global Access
                      </p>
                      <FieldInfoTooltip>
                        <div className="space-y-1.5">
                          <p>
                            Overrides here apply to{" "}
                            <strong className="text-foreground">
                              this account specifically
                            </strong>{" "}
                            and beat whatever their groups grant for that one
                            permission.
                          </p>
                          {!viewerIsSystemAdmin ? (
                            <p>
                              Only a{" "}
                              <strong className="text-foreground">
                                System Administrator
                              </strong>{" "}
                              can change these -{" "}
                              <em>a Manage users grant alone never includes
                              the power to hand out (or take away)
                              permissions</em>, including this one.
                            </p>
                          ) : isSelf ? (
                            <p>
                              <strong className="text-foreground">
                                You cannot change your own overrides.
                              </strong>
                            </p>
                          ) : null}
                          {isAdminDraft ? (
                            <p>
                              This account is currently an{" "}
                              <strong className="text-foreground">
                                Administrator
                              </strong>
                              , so it already has every permission regardless
                              of the settings below.
                            </p>
                          ) : systemAdminEffective ? (
                            <p>
                              This account currently holds{" "}
                              <strong className="text-foreground">
                                System administrator
                              </strong>{" "}
                              (see the tree below for how), which already
                              grants every other permission too.
                            </p>
                          ) : null}
                        </div>
                      </FieldInfoTooltip>
                    </div>
                  </div>
                  {/* A single glance at what this account actually has right
                      now, ahead of the per-permission rows below where that
                      answer is otherwise spread across four separate
                      badges - the summary an operator needs before deciding
                      what to change. */}
                  <div className="border-border/60 mt-2.5 border-t pt-2.5">
                    <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                      Currently granted
                    </p>
                    {isAdminDraft || currentlyGranted.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {isAdminDraft ? (
                          <Badge variant="success" className="text-[10px]">
                            All permissions (Administrator role)
                          </Badge>
                        ) : (
                          currentlyGranted.map((permission) => (
                            <Badge
                              key={permission}
                              variant="success"
                              className="text-[10px]"
                            >
                              {PERMISSION_CONFIG[permission].label}
                            </Badge>
                          ))
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">
                        No global permissions currently granted.
                      </p>
                    )}
                  </div>
                </div>

                {(() => {
                  // A folder-tree read on the same 4 rows as before: System
                  // administrator is the root every other permission nests
                  // under, since granting it from any source implies the
                  // rest regardless of their own setting (see
                  // `isEffectivelyGranted` above). Not a real
                  // expand/collapse tree - there are only ever 4 rows total,
                  // so both levels stay visible at once.
                  function renderPermissionRow(permission: GlobalPermission) {
                    const config = PERMISSION_CONFIG[permission];
                    const Icon = config.icon;
                    const choice = overrides[permission];
                    const effective = isEffectivelyGranted(permission);
                    const isParent = permission === "system_admin";
                    // A child reads (and locks) as forced-on whenever the
                    // parent is effectively granted from any source - Role,
                    // a group, or its own override - matching
                    // `isEffectivelyGranted`'s shortcut, so the dropdown
                    // never claims a choice this account's real access
                    // already overrides.
                    const impliedByParent = !isParent && systemAdminEffective;
                    const rowDisabled =
                      pending ||
                      isSelf ||
                      isAdminDraft ||
                      !viewerIsSystemAdmin ||
                      impliedByParent;
                    const rowTitle = isAdminDraft
                      ? "Administrators have every permission unconditionally - overrides have no effect."
                      : impliedByParent
                        ? "Included automatically - this account already has System administrator, which grants every other permission too."
                        : !viewerIsSystemAdmin
                          ? "Only a System Administrator can change Global Access overrides."
                          : undefined;
                    const valueLabel = isAdminDraft
                      ? "Included in Admin role"
                      : impliedByParent
                        ? "Included via System administrator"
                        : choice === "inherit"
                          ? "Inherit from groups"
                          : choice === "enabled"
                            ? "Force enabled"
                            : "Force disabled";
                    return (
                      <div
                        key={permission}
                        className={cn(
                          "relative flex h-14 items-center justify-between gap-3 px-5",
                          !isParent && "before:bg-border before:absolute before:top-1/2 before:left-10 before:h-px before:w-9",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={cn(
                              "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-lg border",
                              !isParent && "ml-14",
                              effective
                                ? "border-primary/40 bg-primary-subtle text-primary"
                                : "border-border bg-surface text-muted-foreground",
                            )}
                          >
                            <Icon className="size-4.5" />
                          </div>
                          <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                            <span className="text-foreground text-xs font-semibold">
                              {config.label}
                            </span>
                            <FieldInfoTooltip>
                              {config.description}
                            </FieldInfoTooltip>
                            <Badge
                              variant={effective ? "success" : "neutral"}
                              className="text-[10px]"
                            >
                              {effective ? "Active" : "Disabled"}
                            </Badge>
                          </div>
                        </div>
                        <Select
                          value={choice}
                          onValueChange={(value) =>
                            isParent
                              ? handleSystemAdminChange(value as OverrideChoice)
                              : setOverrides((current) => ({
                                  ...current,
                                  [permission]: value as OverrideChoice,
                                }))
                          }
                          disabled={rowDisabled}
                        >
                          <SelectTrigger
                            className="h-8 w-52 shrink-0 text-xs"
                            aria-label={`${config.label} override`}
                            title={rowTitle}
                          >
                            <SelectValue>{valueLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">
                              Inherit from groups
                            </SelectItem>
                            <SelectItem value="enabled">
                              Force enabled
                            </SelectItem>
                            <SelectItem value="disabled">
                              Force disabled
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  return (
                    <div className="border-border bg-surface rounded-lg border p-2">
                      {renderPermissionRow("system_admin")}
                      {/* The trunk's `left-10` matches the parent icon's own
                          center-x above (20px row padding + half of its
                          40px chip), and each child row's own `::before`
                          stub (drawn in `renderPermissionRow`) picks up
                          from `left-10` and runs to that child's indented
                          icon - one continuous line down to the middle of
                          the last child row (`bottom-7`, half a row's
                          height), same shape as a file tree's guide line. */}
                      <div className="relative">
                        <div className="bg-border absolute top-0 bottom-7 left-10 w-px" />
                        {CHILD_PERMISSIONS.map((permission) => (
                          <div key={permission}>{renderPermissionRow(permission)}</div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {error ? (
            <p
              role="alert"
              className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending ||
                !hasChanges ||
                (changingPassword && (!passwordIsValid || !passwordsMatch))
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

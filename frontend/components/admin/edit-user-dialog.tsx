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
import type { GlobalPermission, User } from "@/types/api";

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
 * exist. Mirrors `passwordRules` in `change-password-form.tsx`. */
function passwordRules(password: string, confirmation: string) {
  return [
    {
      key: "length",
      label: "At least 8 characters",
      met: password.length >= 8,
    },
    {
      key: "case",
      label: "An uppercase and lowercase letter",
      met: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    {
      key: "numberOrSymbol",
      label: "A number or special character",
      met: /\d/.test(password) || /[^A-Za-z0-9]/.test(password),
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

type TabKey = "general" | "access";

const PERMISSION_CONFIG: Record<
  GlobalPermission,
  {
    label: string;
    description: string;
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
    description:
      "Allows creating, editing, resetting passwords, and deactivating user accounts.",
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
    description:
      "Full administrative control over workspace settings, security, and system backups.",
    icon: ShieldAlert,
  },
};
const PERMISSIONS = Object.keys(PERMISSION_CONFIG) as GlobalPermission[];

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
  open,
  onOpenChange,
}: {
  user: User;
  isSelf: boolean;
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
      setRole(user.is_superuser ? "admin" : "member");
      setStatusValue(user.is_active ? "active" : "disabled");
      setOverrides(overridesFromUser(user));
      setPassword("");
      setConfirm("");
      setError(null);
    }
  }, [open, user]);

  const initialRole = user.is_superuser ? "admin" : "member";
  const initialStatus = user.is_active ? "active" : "disabled";
  const initialOverrides = overridesFromUser(user);

  const changingPassword = password.length > 0 || confirm.length > 0;
  const rules = passwordRules(password, confirm);
  // First 3 rules are the password's own shape; "Passwords match" is kept
  // separate so a valid-but-not-yet-confirmed password doesn't read as
  // invalid before the user has even reached the Confirm field.
  const passwordIsValid = rules.slice(0, 3).every((rule) => rule.met);
  const passwordsMatch = rules[3]!.met;
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
        className="max-w-xl"
        title={`Edit ${user.username}`}
        description="Change this account's role, access, password, and permission overrides."
      >
        <div className="border-border -mt-1 flex gap-2 border-b">
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
                        </ul>
                      </FieldInfoTooltip>
                    </div>
                    <Select
                      value={role}
                      onValueChange={setRole}
                      disabled={pending || isSelf}
                    >
                      <SelectTrigger
                        id="edit-user-role"
                        aria-label="Role"
                        title={
                          isSelf
                            ? "You cannot change your own role."
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
            ) : (
              <div className="space-y-2">
                <div className="bg-surface-sunken/50 border-border flex items-start gap-2.5 rounded-lg border p-3">
                  <ShieldCheck className="text-primary mt-0.5 size-4.5 shrink-0" />
                  <div className="text-xs">
                    <p className="text-foreground font-semibold">
                      Workspace Global Access
                    </p>
                    <p className="text-muted-foreground mt-0.5 leading-normal">
                      Overrides here apply to this account specifically and beat
                      whatever their groups grant for that one permission.
                      {isSelf ? " You cannot change your own overrides." : null}
                      {role === "admin"
                        ? " This account is currently an Administrator, so it already has every permission regardless of the settings below."
                        : null}
                    </p>
                  </div>
                </div>

                <div className="border-border divide-border bg-surface divide-y overflow-hidden rounded-lg border">
                  {PERMISSIONS.map((permission) => {
                    const config = PERMISSION_CONFIG[permission];
                    const Icon = config.icon;
                    // While the draft Role is Administrator, every permission
                    // reads as granted regardless of `user.global_permissions`
                    // (the *saved* state) or the override chosen below - it
                    // mirrors what flipping Role to Admin and saving would
                    // actually produce, immediately, without waiting for a
                    // save round-trip.
                    const isAdminDraft = role === "admin";
                    const effective =
                      isAdminDraft ||
                      user.global_permissions.includes(permission);
                    const choice = overrides[permission];
                    return (
                      <div
                        key={permission}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={
                              "flex size-8 shrink-0 items-center justify-center rounded-lg border " +
                              (effective
                                ? "bg-primary-subtle text-primary border-primary/30"
                                : "bg-muted/40 text-muted-foreground border-border/60")
                            }
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-foreground text-xs font-semibold">
                                {config.label}
                              </span>
                              <Badge
                                variant={effective ? "success" : "neutral"}
                                className="text-[10px]"
                              >
                                {effective ? "Active" : "Disabled"}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground text-xs leading-normal">
                              {config.description}
                            </p>
                          </div>
                        </div>
                        <Select
                          value={choice}
                          onValueChange={(value) =>
                            setOverrides((current) => ({
                              ...current,
                              [permission]: value as OverrideChoice,
                            }))
                          }
                          disabled={pending || isSelf || isAdminDraft}
                        >
                          <SelectTrigger
                            className="h-8 w-44 shrink-0 text-xs"
                            aria-label={`${config.label} override`}
                            title={
                              isAdminDraft
                                ? "Administrators have every permission unconditionally - overrides have no effect."
                                : undefined
                            }
                          >
                            <SelectValue>
                              {isAdminDraft
                                ? "Included in Admin role"
                                : choice === "inherit"
                                  ? "Inherit from groups"
                                  : choice === "enabled"
                                    ? "Force enabled"
                                    : "Force disabled"}
                            </SelectValue>
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
                  })}
                </div>
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

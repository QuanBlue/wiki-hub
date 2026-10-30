"use client";

import { Check, KeyRound, Loader2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  notifyAccountEmail,
  notifyAdminGranted,
  useCanEmailAccounts,
} from "@/components/admin/account-email-option";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Page, User } from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UsernameCheck = "idle" | "checking" | "available" | "taken" | "error";

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function AddAdminDialog({
  viewerIsSystemAdmin,
  variant = "primary",
  size = "sm",
  className,
}: {
  viewerIsSystemAdmin: boolean;
  variant?: "primary" | "secondary" | "subtle" | "ghost" | "danger" | "link";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"promote" | "create">("promote");

  // --- Promote Tab State ---
  const [members, setMembers] = useState<User[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [promoteReceiveEmails, setPromoteReceiveEmails] = useState(true);
  const [promotePending, setPromotePending] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  // --- Create Tab State ---
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createReceiveEmails, setCreateReceiveEmails] = useState(true);
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>("idle");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const canEmailAccounts = useCanEmailAccounts();

  // Load eligible workspace members when dialog opens
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingMembers(true);
    setPromoteError(null);

    api
      .get<Page<User>>("/api/v1/users?role=member&status=active&limit=100")
      .then((res) => {
        if (!active) return;
        setMembers(res.items);
      })
      .catch((err) => {
        if (!active) return;
        setPromoteError(
          err instanceof ApiError
            ? err.message
            : t("adminUsers.promoteError"),
        );
      })
      .finally(() => {
        if (active) setLoadingMembers(false);
      });

    return () => {
      active = false;
    };
  }, [open, selectedUserId, t]);

  // Username availability check for Create Tab
  useEffect(() => {
    const normalized = username.trim();
    if (!normalized || !USERNAME_PATTERN.test(normalized)) {
      setUsernameCheck("idle");
      return;
    }
    let active = true;
    setUsernameCheck("checking");
    const timer = window.setTimeout(() => {
      void api
        .get<Page<User>>(
          `/api/v1/users?q=${encodeURIComponent(normalized)}&limit=10&offset=0`,
        )
        .then((result) => {
          if (!active) return;
          const taken = result.items.some(
            (user) => user.username.toLowerCase() === normalized.toLowerCase(),
          );
          setUsernameCheck(taken ? "taken" : "available");
        })
        .catch(() => {
          if (active) setUsernameCheck("error");
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username]);

  function reset() {
    setTab("promote");
    setSelectedUserId("");
    setPromoteReceiveEmails(true);
    setPromoteError(null);
    setFirstName("");
    setLastName("");
    setUsername("");
    setEmail("");
    setPassword("");
    setCreateReceiveEmails(true);
    setUsernameCheck("idle");
    setCreateError(null);
  }

  const selectedMember = members.find((m) => m.id === selectedUserId);

  // Handle Promote Submit
  async function handlePromoteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedUserId || !selectedMember) return;
    setPromotePending(true);
    setPromoteError(null);
    const targetMember = selectedMember;
    try {
      await api.patch<User>(`/api/v1/users/${selectedUserId}`, {
        is_superuser: true,
        receive_admin_emails: promoteReceiveEmails,
      });
      toast.success(
        t("adminUsers.promoteSuccessToast", {
          username: targetMember.full_name || targetMember.username,
        }),
      );
      setOpen(false);
      reset();
      router.refresh();
      if (canEmailAccounts) {
        const outcome = await notifyAdminGranted(targetMember.id);
        if (outcome?.email_sent) {
          toast.success(`Told ${targetMember.email} they're now an administrator.`);
        } else {
          toast.error(`Could not email ${targetMember.email} about the new role.`);
        }
      }
    } catch (err) {
      setPromoteError(
        err instanceof ApiError ? err.message : t("adminUsers.promoteError"),
      );
    } finally {
      setPromotePending(false);
    }
  }

  // Handle Create Submit
  const usernameInvalid = username.length > 0 && !USERNAME_PATTERN.test(username);
  const emailInvalid = email.length > 0 && !EMAIL_PATTERN.test(email.trim());
  const passwordHasLower = /[a-z]/.test(password);
  const passwordHasUpper = /[A-Z]/.test(password);
  const passwordHasNumberOrSymbol = /[0-9]|[^A-Za-z0-9]/.test(password);

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    if (usernameCheck !== "available") return;
    setCreatePending(true);
    setCreateError(null);
    const submittedPassword = password;
    try {
      const created = await api.post<User>("/api/v1/users", {
        username: username.trim(),
        email: email.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        password: submittedPassword,
        is_superuser: true,
        receive_admin_emails: createReceiveEmails,
      });
      toast.success(
        t("adminUsers.promoteSuccessToast", {
          username: created.full_name || created.username,
        }),
      );
      setOpen(false);
      reset();
      router.refresh();
      if (canEmailAccounts) {
        const outcome = await notifyAccountEmail(
          "created",
          created.id,
          submittedPassword,
        );
        if (outcome?.email_sent) {
          toast.success(`Sign-in details emailed to ${created.email}.`);
        } else {
          toast.error(
            `Could not email the sign-in details to ${created.email}. Share the password another way.`,
          );
        }
      }
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Could not create the administrator.",
      );
      if (err instanceof ApiError && err.code === "username_taken") {
        setUsernameCheck("taken");
      }
    } finally {
      setCreatePending(false);
    }
  }

  if (!viewerIsSystemAdmin) {
    return null;
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={cn("gap-1.5", className)}
        title={t("adminUsers.addAdminTitle")}
      >
        <ShieldCheck className="size-4 shrink-0" />
        <span>{t("adminUsers.addAdmin")}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          className="max-w-xl"
          title={t("adminUsers.addAdminTitle")}
          description={t("adminUsers.addAdminDesc")}
        >
          {/* Segmented Mode Selector */}
          <div className="border-border bg-surface-sunken flex items-center rounded-lg border p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setTab("promote")}
              className={cn(
                "focus-visible:ring-ring flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                tab === "promote"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Users className="size-3.5" />
              <span>{t("adminUsers.tabPromoteMember")}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("create")}
              className={cn(
                "focus-visible:ring-ring flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                tab === "create"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <UserPlus className="size-3.5" />
              <span>{t("adminUsers.tabCreateAdmin")}</span>
            </button>
          </div>

          {tab === "promote" ? (
            <form onSubmit={handlePromoteSubmit} className="mt-4 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="promote-member-select">
                  {t("adminUsers.selectMemberLabel")}
                </Label>
                {loadingMembers ? (
                  <div className="border-border bg-surface-sunken flex h-9 items-center gap-2 rounded-md border px-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Loading workspace members…</span>
                  </div>
                ) : members.length === 0 ? (
                  <p className="border-border bg-surface-sunken rounded-md border p-3 text-xs text-muted-foreground">
                    {t("adminUsers.noEligibleMembers")}
                  </p>
                ) : (
                  <SearchableSelect
                    id="promote-member-select"
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                    placeholder={t("adminUsers.selectMemberPlaceholder")}
                    searchPlaceholder={t("adminUsers.selectMemberSearchPlaceholder")}
                    emptyMessage={t("adminUsers.selectMemberEmpty")}
                    disabled={promotePending}
                    items={members.map((m) => ({
                      value: m.id,
                      label: `${m.full_name || m.username} (@${m.username})`,
                      searchText: `${m.full_name ?? ""} ${m.username} ${m.email}`,
                    }))}
                  />
                )}
              </div>

              {selectedMember && (
                <div className="border-border bg-surface-sunken flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-primary-subtle text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {initials(selectedMember.full_name || selectedMember.username)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {selectedMember.full_name || selectedMember.username}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        @{selectedMember.username} • {selectedMember.email}
                      </p>
                    </div>
                  </div>
                  <Badge variant="info">Member</Badge>
                </div>
              )}

              {/* Email Notification Switch */}
              <div className="border-border bg-surface rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="promote-receive-emails"
                      className="cursor-pointer text-xs font-semibold"
                    >
                      {t("adminUsers.formReceiveAdminEmails")}
                    </Label>
                    <p className="text-muted-foreground text-xs leading-normal">
                      {t("adminUsers.formReceiveAdminEmailsHelp")}
                    </p>
                  </div>
                  <button
                    type="button"
                    id="promote-receive-emails"
                    role="switch"
                    aria-checked={promoteReceiveEmails}
                    onClick={() => setPromoteReceiveEmails((v) => !v)}
                    disabled={promotePending}
                    className={cn(
                      "focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      promoteReceiveEmails ? "bg-success" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "bg-surface pointer-events-none inline-block size-3.5 transform rounded-full shadow-sm ring-0 transition-transform duration-200 ease-in-out",
                        promoteReceiveEmails ? "translate-x-4.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              </div>

              <p className="text-muted-foreground text-xs">
                {t("adminUsers.promoteWarning")}
              </p>

              {promoteError && (
                <p className="text-danger bg-danger-subtle rounded-md px-3 py-2 text-xs">
                  {promoteError}
                </p>
              )}

              <DialogFooter className="mt-6 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                  disabled={promotePending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={promotePending || !selectedUserId || members.length === 0}
                  className="gap-1.5"
                >
                  {promotePending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  <span>{t("adminUsers.submitPromote")}</span>
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4" noValidate>
              <div className="bg-primary-subtle text-primary flex items-start gap-3 rounded-md px-3 py-2.5">
                <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="text-xs leading-5">
                  {canEmailAccounts
                    ? "WikiHub will email the sign-in details to them automatically. Share the password yourself too if they need it sooner."
                    : "Share the temporary password securely. WikiHub does not send invitation e-mails."}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-admin-first-name">First name</Label>
                  <Input
                    id="new-admin-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    required
                    disabled={createPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-admin-last-name">
                    Last name <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="new-admin-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    disabled={createPending}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="new-admin-username">Username</Label>
                  <span className="text-xs">
                    {usernameCheck === "checking" && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> Checking…
                      </span>
                    )}
                    {usernameCheck === "available" && (
                      <span className="text-success inline-flex items-center gap-1">
                        <Check className="size-3" /> Available
                      </span>
                    )}
                    {usernameCheck === "taken" && (
                      <span className="text-danger">Username is already taken</span>
                    )}
                  </span>
                </div>
                <Input
                  id="new-admin-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="janedoe"
                  required
                  disabled={createPending}
                  aria-invalid={usernameInvalid || usernameCheck === "taken"}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-admin-email">E-mail</Label>
                <Input
                  id="new-admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  required
                  disabled={createPending}
                  aria-invalid={emailInvalid}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-admin-password">Temporary password</Label>
                <PasswordInput
                  id="new-admin-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={createPending}
                  autoComplete="new-password"
                />
                <ul className="text-muted-foreground grid grid-cols-2 gap-1 pt-1 text-xs">
                  <li className={cn("flex items-center gap-1", password.length >= MIN_PASSWORD_LENGTH && "text-success")}>
                    <Check className="size-3" /> At least {MIN_PASSWORD_LENGTH} characters
                  </li>
                  <li className={cn("flex items-center gap-1", passwordHasLower && "text-success")}>
                    <Check className="size-3" /> Lowercase letter
                  </li>
                  <li className={cn("flex items-center gap-1", passwordHasUpper && "text-success")}>
                    <Check className="size-3" /> Uppercase letter
                  </li>
                  <li className={cn("flex items-center gap-1", passwordHasNumberOrSymbol && "text-success")}>
                    <Check className="size-3" /> Number or symbol
                  </li>
                </ul>
              </div>

              {/* Email Notification Switch */}
              <div className="border-border bg-surface rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="create-receive-emails"
                      className="cursor-pointer text-xs font-semibold"
                    >
                      {t("adminUsers.formReceiveAdminEmails")}
                    </Label>
                    <p className="text-muted-foreground text-xs leading-normal">
                      {t("adminUsers.formReceiveAdminEmailsHelp")}
                    </p>
                  </div>
                  <button
                    type="button"
                    id="create-receive-emails"
                    role="switch"
                    aria-checked={createReceiveEmails}
                    onClick={() => setCreateReceiveEmails((v) => !v)}
                    disabled={createPending}
                    className={cn(
                      "focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      createReceiveEmails ? "bg-success" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "bg-surface pointer-events-none inline-block size-3.5 transform rounded-full shadow-sm ring-0 transition-transform duration-200 ease-in-out",
                        createReceiveEmails ? "translate-x-4.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              </div>

              {createError && (
                <p className="text-danger bg-danger-subtle rounded-md px-3 py-2 text-xs">
                  {createError}
                </p>
              )}

              <DialogFooter className="mt-6 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                  disabled={createPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    createPending ||
                    !firstName.trim() ||
                    !username.trim() ||
                    usernameInvalid ||
                    usernameCheck !== "available" ||
                    !email.trim() ||
                    emailInvalid ||
                    password.length < MIN_PASSWORD_LENGTH ||
                    !passwordHasLower ||
                    !passwordHasUpper ||
                    !passwordHasNumberOrSymbol
                  }
                  className="gap-1.5"
                >
                  {createPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserPlus className="size-4" />
                  )}
                  <span>{t("adminUsers.submitCreateAdmin")}</span>
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


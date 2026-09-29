"use client";

import {
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { MailError } from "@/components/admin/mail-error";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { generatePassword } from "@/lib/password";
import { richText } from "@/lib/rich-text";
import type {
  AutoActionResult,
  InboxItem,
  MatchedAccount,
  RequestActionPreview,
} from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;

/**
 * What an administrator can do about an account or password-reset request
 * without leaving the Inbox: either let WikiHub do it and email the person, or
 * do it by hand (the normal Create user form, or a password they choose).
 *
 * The automatic route is only offered when it is safe - see the backend's
 * `RequestActionService` for the rules - and says up front what it will do, or
 * why it is not available.
 */
export function RequestActions({
  item,
  onChanged,
}: {
  item: InboxItem;
  /** The request changed (resolved): the list and its counts follow. */
  onChanged: (updated: InboxItem) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [preview, setPreview] = useState<RequestActionPreview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AutoActionResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);

  const actionable = item.kind !== "other";
  const resolved = item.resolved_at !== null;

  useEffect(() => {
    if (!actionable || resolved) return;
    let active = true;
    void api
      .get<RequestActionPreview>(`/api/v1/admin-mail/inbox/${item.id}/actions`)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [item.id, actionable, resolved]);

  if (!actionable) return null;

  // What the two buttons do. An account request normally creates the account -
  // but when the address already has one, the person most likely lost the
  // password, so both buttons become a password reset for that account.
  const willCreate = preview
    ? preview.auto_action !== "reset_password"
    : item.kind === "account";
  const existingAccount =
    item.kind === "account" && preview?.auto_action === "reset_password";
  // The other way round: a password reset that names no account has nothing
  // to reset, so the automatic action becomes creating one instead.
  const noAccountForReset =
    item.kind === "password_reset" && preview?.auto_action === "create_account";

  async function runAutomatic() {
    setPending(true);
    try {
      const outcome = await api.post<AutoActionResult>(
        `/api/v1/admin-mail/inbox/${item.id}/${willCreate ? "create-account" : "reset-password"}`,
        { login_url: `${window.location.origin}/login` },
      );
      setResult(outcome);
      onChanged(outcome.item);
      if (outcome.email_sent) {
        toast.success(
          richText(
            t(willCreate ? "adminInbox.doneCreated" : "adminInbox.doneReset", {
              username: outcome.username,
              email: outcome.emailed_to,
            }),
          ),
        );
      }
    } catch (error) {
      toast.error(apiErrorText(error, "adminInbox.actionError"));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  // After doing it by hand the request is handled too.
  async function markResolved() {
    try {
      onChanged(
        await api.patch<InboxItem>(`/api/v1/admin-mail/inbox/${item.id}`, {
          resolved: true,
        }),
      );
    } catch (error) {
      toast.error(apiErrorText(error, "adminInbox.actionError"));
    }
  }

  function blockedText(value: RequestActionPreview): string {
    const account = value.matched_account;
    switch (value.auto_blocked) {
      case "email_in_use":
        return t("adminInbox.blockedEmailInUse", { email: item.requester_email });
      case "email_invalid":
        return t("adminInbox.blockedEmailInvalid");
      case "email_mismatch":
        return t("adminInbox.blockedEmailMismatch", {
          email: item.requester_email,
          username: account?.username ?? "",
          accountEmail: account?.email ?? "",
        });
      case "account_inactive":
        return t("adminInbox.blockedAccountInactive", {
          username: account?.username ?? "",
        });
      case "account_protected":
        return t("adminInbox.blockedAccountProtected");
      case "peer_admin":
        return t("adminInbox.blockedPeerAdmin");
      default:
        return "";
    }
  }

  // The result of an automatic action stays on screen, above everything else.
  // When the email went out, that message is the whole story - the username
  // and address are not spelled out here too. When it failed, the password is
  // shown only now and never stored, so it still needs to reach the
  // administrator some other way; either way the details sit behind one eye
  // toggle instead of always being on screen.
  if (result) {
    const rows: { label: string; value: string }[] = [
      { label: t("adminInbox.fieldUsername"), value: result.username },
      { label: t("adminInbox.fieldEmail"), value: result.emailed_to },
    ];
    if (result.password) {
      rows.push({ label: t("adminInbox.passwordLabel"), value: result.password });
    }

    return (
      <section
        role="status"
        className={
          result.email_sent
            ? "border-success/30 bg-success-bg text-success mt-4 rounded-md border px-3 py-2 text-sm"
            : "border-warning/30 bg-warning-bg text-warning mt-4 rounded-md border px-3 py-2 text-sm"
        }
      >
        <p className="flex items-start gap-2 font-semibold">
          {result.email_sent ? (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {/* One span, not the raw fragment: richText() returns several sibling
           * text/`<code>` nodes, and spreading those straight into a flex row
           * turns each into its own flex item - free to shrink to its
           * narrowest word and wrap into a ragged column next to the icon. */}
          <span>
            {richText(
              result.email_sent
                ? t(willCreate ? "adminInbox.doneCreated" : "adminInbox.doneReset", {
                    username: result.username,
                    email: result.emailed_to,
                  })
                : t(
                    willCreate
                      ? "adminInbox.emailFailedCreated"
                      : "adminInbox.emailFailedReset",
                    { username: result.username },
                  ),
            )}
          </span>
        </p>

        {!result.email_sent ? (
          <div className="text-foreground mt-2 text-xs">
            <MailError raw={result.email_error} />
          </div>
        ) : null}

        <AccountDetailsReveal
          rows={rows}
          hint={!result.email_sent ? t("adminInbox.emailFailedHint") : undefined}
        />
      </section>
    );
  }

  if (resolved) {
    return (
      <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {t("adminInbox.actionsResolved")}
      </p>
    );
  }

  const account = preview?.matched_account ?? null;
  const autoAllowed = preview?.auto_allowed === true;
  const autoDetail =
    preview === null
      ? ""
      : autoAllowed
        ? willCreate
          ? t("adminInbox.autoCreateDetail", {
              username: preview.suggested_username ?? "",
              email: item.requester_email,
            })
          : t("adminInbox.autoResetDetail", {
              username: account?.username ?? "",
              email: account?.email ?? "",
            })
        : blockedText(preview);
  const canSetManually = willCreate || account !== null;

  return (
    <section
      aria-label={t("adminInbox.actionsTitle")}
      className="border-border mt-4 rounded-md border p-3"
    >
      <h3 className="text-sm font-semibold">{t("adminInbox.actionsTitle")}</h3>

      {existingAccount && preview?.matched_account ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t("adminInbox.existingAccountNote", {
            username: preview.matched_account.username,
          })}
        </p>
      ) : null}

      {noAccountForReset ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t("adminInbox.noAccountForResetNote", {
            username: item.requester_username ?? item.requester_name,
          })}
        </p>
      ) : null}

      {loadFailed ? (
        <p role="alert" className="text-danger mt-2 text-xs">
          {t("adminInbox.actionsLoadError")}
        </p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!autoAllowed || pending}
              onClick={() => setConfirming(true)}
            >
              {preview === null ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t(willCreate ? "adminInbox.autoCreate" : "adminInbox.autoReset")}
            </Button>
            <p
              className={
                preview !== null && !autoAllowed
                  ? "text-warning text-xs"
                  : "text-muted-foreground text-xs"
              }
            >
              {autoDetail}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={preview === null || !canSetManually}
              onClick={() => (willCreate ? setCreating(true) : setSettingPassword(true))}
            >
              {willCreate ? <UserPlus /> : <KeyRound />}
              {t(willCreate ? "adminInbox.manualCreate" : "adminInbox.manualReset")}
            </Button>
            <p className="text-muted-foreground text-xs">
              {willCreate
                ? t("adminInbox.manualCreateDetail")
                : account
                  ? t("adminInbox.manualResetDetail")
                  : t("adminInbox.noAccountToReset")}
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!pending) setConfirming(open);
        }}
        title={t(willCreate ? "adminInbox.confirmCreateTitle" : "adminInbox.confirmResetTitle")}
        description={
          willCreate
            ? t("adminInbox.confirmCreateBody", {
                username: preview?.suggested_username ?? "",
                name: item.requester_name,
                email: item.requester_email,
              })
            : t("adminInbox.confirmResetBody", {
                username: account?.username ?? "",
                email: account?.email ?? "",
              })
        }
        confirmLabel={t(
          willCreate ? "adminInbox.confirmCreateAction" : "adminInbox.confirmResetAction",
        )}
        pending={pending}
        onConfirm={() => void runAutomatic()}
      />

      {creating && preview ? (
        <CreateUserDialog
          // Only a system administrator has a mailbox, so this is always true.
          viewerIsSystemAdmin
          open
          onOpenChange={setCreating}
          initial={{
            // A password reset collects only a username and email, no name -
            // so there is nothing real to split into first/last here.
            firstName: noAccountForReset
              ? ""
              : (item.requester_name.trim().split(/\s+/)[0] ?? ""),
            lastName: noAccountForReset
              ? ""
              : item.requester_name.trim().split(/\s+/).slice(1).join(" "),
            username: preview.suggested_username ?? "",
            email: item.requester_email,
          }}
          onCreated={() => void markResolved()}
        />
      ) : null}

      {settingPassword && account ? (
        <SetPasswordDialog
          account={account}
          onClose={() => setSettingPassword(false)}
          onDone={() => {
            setSettingPassword(false);
            void markResolved();
          }}
        />
      ) : null}
    </section>
  );
}

/** One labelled value with a small icon button that copies it - a username,
 * address or password someone needs to pass on somewhere else. Reads as a
 * plain detail line (label above value) rather than a form field, since
 * nothing here is ever edited in place. */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("adminInbox.copied"));
    } catch {
      toast.error(t("adminInbox.copyFailed"));
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {label}
        </div>
        <div className="text-foreground mt-0.5 font-mono text-sm break-all select-all">
          {value}
        </div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="shrink-0"
        aria-label={`${t("adminInbox.copy")} ${label}`}
        title={t("adminInbox.copy")}
        onClick={() => void copy()}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

/** The username/address (and, only when the email failed, the password) that
 * go with an automatic action - collapsed behind one eye toggle rather than
 * spelled out by default, since most of the time the email already told the
 * person and nobody else needs to see them on screen. */
function AccountDetailsReveal({
  rows,
  hint,
}: {
  rows: { label: string; value: string }[];
  hint?: string;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="mt-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-foreground/80 hover:text-foreground -ml-2 h-7 gap-1.5 px-2 text-xs"
        onClick={() => setRevealed((value) => !value)}
        aria-expanded={revealed}
      >
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        {t(revealed ? "adminInbox.hideDetails" : "adminInbox.showDetails")}
      </Button>

      {revealed ? (
        <div className="bg-surface border-border/60 divide-border/60 mt-1.5 divide-y rounded-md border">
          {hint ? <p className="text-foreground px-3 py-2 text-xs">{hint}</p> : null}
          {rows.map((row) => (
            <CopyRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Choose a new password for the account a request is about. */
function SetPasswordDialog({
  account,
  onClose,
  onDone,
}: {
  account: MatchedAccount;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/v1/users/${account.id}/password-reset`, {
        new_password: password,
      });
      toast.success(richText(t("adminInbox.passwordSet", { username: account.username })));
      onDone();
    } catch (err) {
      setError(apiErrorText(err, "adminInbox.actionError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        title={t("adminInbox.passwordDialogTitle", { username: account.username })}
        description={t("adminInbox.passwordDialogBody")}
        className="max-w-md"
      >
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="request-new-password">{t("adminInbox.newPassword")}</Label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <PasswordInput
                  id="request-new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                  required
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setPassword(generatePassword())}
              >
                <Sparkles /> {t("adminInbox.generatePassword")}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {account.full_name || account.username} · {account.email}
            </p>
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
            <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={password.length < MIN_PASSWORD_LENGTH || pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("adminInbox.setPassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

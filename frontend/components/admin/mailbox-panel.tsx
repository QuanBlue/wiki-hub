"use client";

import {
  ArrowRight,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Shuffle,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useMailSummary } from "@/components/layout/mail-summary-provider";
import { MailError } from "@/components/admin/mail-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import {
  formatDateTime,
  mailboxStatus,
  mailErrorKey,
  SMTP_PRESETS,
  SMTP_SECURITY_KEYS,
} from "@/lib/admin-mail-ui";
import { useTranslation } from "@/lib/i18n/context";
import type {
  AdminAccount,
  AdminMailbox,
  MailboxTestResult,
  SmtpSecurity,
} from "@/types/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const HOST_PATTERN = /^[A-Za-z0-9.\-:[\]]+$/;
const CUSTOM_PROVIDER = "custom";

export function MailboxPanel({
  initialMailboxes,
  administrators,
  initialUpdateId,
  currentUserId = "",
  currentUserIsProtected = true,
}: {
  initialMailboxes: AdminMailbox[];
  /** Every account that holds `system_admin`: the only ones a mailbox may be linked to. */
  administrators: AdminAccount[];
  /** A mailbox whose password dialog should open straight away, from the banner's link. */
  initialUpdateId?: string;
  /** The signed-in account, to tell its own row apart from a peer's - see
   * `canManage`. Defaults to "everything is manageable" so existing callers
   * that render this panel without an identity (tests exercising behaviour
   * that has nothing to do with ownership) keep working unchanged. */
  currentUserId?: string;
  currentUserIsProtected?: boolean;
}) {
  const { t, locale, apiErrorText } = useTranslation();
  const { refresh: refreshMailSummary } = useMailSummary();
  const [mailboxes, setMailboxes] = useState(initialMailboxes);

  // Mirrors the backend's `_assert_mailbox_editable`: every system
  // administrator can see the full list (so they know who to ask, and what
  // the pool looks like), but only a mailbox's own account - or the
  // built-in super administrator - may reconfigure, re-key, test or remove
  // it. Without this the buttons below would invite a click the server was
  // always going to reject.
  function canManage(mailbox: AdminMailbox): boolean {
    return currentUserIsProtected || mailbox.user_id === currentUserId;
  }

  function inPool(mailbox: AdminMailbox): boolean {
    return mailbox.health_status === "ok" && mailbox.user_is_active;
  }

  const poolSize = mailboxes.filter(inPool).length;
  const [formTarget, setFormTarget] = useState<AdminMailbox | "new" | null>(
    null,
  );
  const [passwordTarget, setPasswordTarget] = useState<AdminMailbox | null>(
    () => initialMailboxes.find((item) => item.id === initialUpdateId) ?? null,
  );
  const [removeTarget, setRemoveTarget] = useState<AdminMailbox | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const taken = new Set(mailboxes.map((item) => item.user_id));
  const eligible = administrators.filter((account) => !taken.has(account.id));

  function replace(updated: AdminMailbox) {
    setMailboxes((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    // Fixing or breaking a mailbox may change the banner for its owner.
    refreshMailSummary();
  }

  async function check(mailbox: AdminMailbox) {
    setBusyId(mailbox.id);
    try {
      const result = await api.post<MailboxTestResult>(
        `/api/v1/admin-mail/mailboxes/${mailbox.id}/test`,
      );
      if (result.ok) toast.success(t("adminMail.checkOk"));
      else {
        toast.error(
          t("adminMail.checkFailed", { reason: t(mailErrorKey(result.error)) }),
        );
      }
      const fresh = await api.get<AdminMailbox[]>(
        "/api/v1/admin-mail/mailboxes",
      );
      setMailboxes(fresh);
      refreshMailSummary();
    } catch (error) {
      toast.error(apiErrorText(error, "adminMail.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(mailbox: AdminMailbox) {
    setBusyId(mailbox.id);
    try {
      replace(
        await api.patch<AdminMailbox>(
          `/api/v1/admin-mail/mailboxes/${mailbox.id}`,
          { is_enabled: !mailbox.is_enabled },
        ),
      );
    } catch (error) {
      toast.error(apiErrorText(error, "adminMail.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`/api/v1/admin-mail/mailboxes/${removeTarget.id}`);
      setMailboxes((current) =>
        current.filter((item) => item.id !== removeTarget.id),
      );
      toast.success(t("adminMail.removed"));
      setRemoveTarget(null);
      refreshMailSummary();
    } catch (error) {
      toast.error(apiErrorText(error, "adminMail.actionError"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setFormTarget("new")}
        >
          <Plus /> {t("adminMail.addMailbox")}
        </Button>
      </div>

      {mailboxes.length === 0 ? (
        <div className="border-border bg-surface rounded-xl border p-10 text-center">
          <Mail
            aria-hidden
            className="text-muted-foreground mx-auto size-8"
          />
          <p className="mt-3 font-semibold">{t("adminMail.emptyTitle")}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {t("adminMail.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border-border bg-surface-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3">
            <Shuffle
              aria-hidden
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
            />
            <p className="text-muted-foreground text-sm">
              {t("adminMail.poolSummary", {
                count: String(poolSize),
                total: String(mailboxes.length),
              })}
            </p>
          </div>
          <div className="border-border bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">
                  {t("adminMail.columnAccount")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("adminMail.columnMailbox")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("adminMail.columnServer")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("adminMail.columnStatus")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("adminMail.columnChecked")}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">
                    {t("adminMail.columnActions")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((mailbox) => {
                const status = mailboxStatus(mailbox);
                const busy = busyId === mailbox.id;
                const managed = canManage(mailbox);
                const lockedTitle = managed
                  ? undefined
                  : t("adminMail.peerProtected", {
                      name: mailbox.user_full_name || mailbox.username,
                    });
                return (
                  <tr
                    key={mailbox.id}
                    className="border-border hover:bg-surface-hover border-b align-top transition-colors duration-150 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {mailbox.user_full_name || mailbox.username}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        @{mailbox.username}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{mailbox.email}</div>
                      {mailbox.display_name ? (
                        <div className="text-muted-foreground text-xs">
                          {mailbox.display_name}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      {mailbox.smtp_host}:{mailbox.smtp_port}
                      <div>{t(SMTP_SECURITY_KEYS[mailbox.smtp_security])}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={status.tone}>{t(status.labelKey)}</Badge>
                        {inPool(mailbox) ? (
                          <Badge variant="info" title={t("adminMail.inPoolHelp")}>
                            {t("adminMail.inPool")}
                          </Badge>
                        ) : null}
                      </div>
                      {mailbox.effective_enabled && mailbox.health_error ? (
                        <div className="text-muted-foreground mt-1 max-w-64 text-xs break-words">
                          <MailError raw={mailbox.health_error} />
                        </div>
                      ) : null}
                      {!mailbox.user_is_active ? (
                        <p className="text-muted-foreground mt-1 max-w-64 text-xs">
                          {t("adminMail.accountDisabledHint")}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                      {mailbox.health_checked_at
                        ? formatDateTime(mailbox.health_checked_at, locale)
                        : t("adminMail.neverChecked")}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy || !managed}
                          onClick={() => void check(mailbox)}
                          aria-label={t("adminMail.checkNow")}
                          title={lockedTitle ?? t("adminMail.checkNow")}
                        >
                          {busy ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <RefreshCw />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!managed}
                          onClick={() => setPasswordTarget(mailbox)}
                          aria-label={t("adminMail.updatePassword")}
                          title={lockedTitle ?? t("adminMail.updatePassword")}
                        >
                          <KeyRound />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!managed}
                          onClick={() => setFormTarget(mailbox)}
                          aria-label={t("adminMail.edit")}
                          title={lockedTitle ?? t("adminMail.edit")}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy || !managed}
                          onClick={() => void toggle(mailbox)}
                          aria-pressed={mailbox.is_enabled}
                          aria-label={
                            mailbox.is_enabled
                              ? t("adminMail.switchOff")
                              : t("adminMail.switchOn")
                          }
                          title={
                            lockedTitle ??
                            (mailbox.is_enabled
                              ? t("adminMail.switchOff")
                              : t("adminMail.switchOn"))
                          }
                          className={
                            mailbox.is_enabled
                              ? "text-success hover:text-success"
                              : undefined
                          }
                        >
                          <Power />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!managed}
                          onClick={() => setRemoveTarget(mailbox)}
                          aria-label={t("adminMail.remove")}
                          title={lockedTitle ?? t("adminMail.remove")}
                          className="text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {formTarget ? (
        <MailboxFormDialog
          key={formTarget === "new" ? "new" : formTarget.id}
          mailbox={formTarget === "new" ? null : formTarget}
          eligible={eligible}
          onClose={() => setFormTarget(null)}
          onSaved={(saved, isNew) => {
            setMailboxes((current) =>
              isNew
                ? [...current, saved].sort((a, b) =>
                    a.email.localeCompare(b.email),
                  )
                : current.map((item) => (item.id === saved.id ? saved : item)),
            );
            refreshMailSummary();
          }}
        />
      ) : null}

      {passwordTarget ? (
        <PasswordDialog
          mailbox={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onSaved={(saved) => {
            replace(saved);
            setPasswordTarget(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null);
        }}
        title={t("adminMail.removeTitle")}
        description={t("adminMail.removeBody", {
          email: removeTarget?.email ?? "",
        })}
        confirmLabel={t("adminMail.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        pending={removing}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function MailboxFormDialog({
  mailbox,
  eligible,
  onClose,
  onSaved,
}: {
  /** `null` creates a new mailbox. */
  mailbox: AdminMailbox | null;
  eligible: AdminAccount[];
  onClose: () => void;
  onSaved: (mailbox: AdminMailbox, isNew: boolean) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const editing = mailbox !== null;
  const [userId, setUserId] = useState(mailbox?.user_id ?? "");
  const [email, setEmail] = useState(mailbox?.email ?? "");
  const [displayName, setDisplayName] = useState(mailbox?.display_name ?? "");
  const [provider, setProvider] = useState(CUSTOM_PROVIDER);
  const [host, setHost] = useState(mailbox?.smtp_host ?? "");
  const [port, setPort] = useState(String(mailbox?.smtp_port ?? 587));
  const [security, setSecurity] = useState<SmtpSecurity>(
    mailbox?.smtp_security ?? "starttls",
  );
  const [username, setUsername] = useState(
    mailbox && mailbox.smtp_username !== mailbox.email
      ? mailbox.smtp_username
      : "",
  );
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(mailbox?.is_enabled ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the mail server said when the pre-save connection test failed.
  const [checkFailure, setCheckFailure] = useState<string | null>(null);

  const selectedAccount = eligible.find((account) => account.id === userId);
  const portNumber = Number(port);
  const portValid =
    Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const valid =
    (editing || userId !== "") &&
    EMAIL_PATTERN.test(email.trim()) &&
    HOST_PATTERN.test(host.trim()) &&
    portValid &&
    (editing || password.length > 0);
  // Nothing here is marked invalid as you type (that would be noisy on a form
  // this long) - so when Save stays disabled, say which field it is still
  // waiting on, in the order a person would fill the form. Not repeated here
  // when there is no eligible account: that already gets its own prominent
  // block, with a way out, right above the picker.
  const saveDisabledReason =
    !editing && userId === ""
      ? eligible.length === 0
        ? null
        : t("adminMail.formChooseAccount")
      : !EMAIL_PATTERN.test(email.trim())
        ? t("adminMail.formEmailInvalid")
        : !HOST_PATTERN.test(host.trim())
          ? t("adminMail.formHostInvalid")
          : !portValid
            ? t("adminMail.formPortInvalid")
            : !editing && password.length === 0
              ? t("adminMail.formPasswordRequired")
              : null;

  function pickProvider(id: string) {
    setProvider(id);
    const preset = SMTP_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setHost(preset.host);
    setPort(String(preset.port));
    setSecurity(preset.security);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    setCheckFailure(null);
    const common = {
      email: email.trim(),
      display_name: displayName.trim() || null,
      smtp_host: host.trim(),
      smtp_port: portNumber,
      smtp_security: security,
      smtp_username: username.trim() || null,
      is_enabled: enabled,
    };
    try {
      if (mailbox) {
        const saved = await api.patch<AdminMailbox>(
          `/api/v1/admin-mail/mailboxes/${mailbox.id}`,
          // A blank password means "keep the stored one": it is left out
          // entirely, never sent as an empty value.
          password ? { ...common, smtp_password: password } : common,
        );
        onSaved(saved, false);
        toast.success(t("adminMail.updated"));
      } else {
        const saved = await api.post<AdminMailbox>(
          "/api/v1/admin-mail/mailboxes",
          { ...common, user_id: userId, smtp_password: password },
        );
        onSaved(saved, true);
        toast.success(t("adminMail.created"));
      }
      onClose();
    } catch (err) {
      // The server tests the connection before saving anything, so a failure
      // here means nothing was stored: explain what the mail server answered.
      if (err instanceof ApiError && err.code.startsWith("mail_")) {
        setCheckFailure(String(err.details.reason ?? ""));
      } else {
        setError(apiErrorText(err, "adminMail.saveError"));
      }
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
        title={editing ? t("adminMail.editMailbox") : t("adminMail.addMailbox")}
        className="max-w-lg"
        // Radix focuses the first tabbable element, which is the account
        // hint's info button - and focus opens its tooltip before anyone has
        // hovered. Start on the first field instead.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('[id^="mailbox-"]')
            ?.focus({ preventScroll: true });
        }}
      >
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="mailbox-account">
                {t("adminMail.formAccount")}
              </Label>
              <InfoTip>{t("adminMail.formAccountHelp")}</InfoTip>
            </div>
            {editing ? (
              <p className="text-sm font-medium">
                {mailbox.user_full_name || mailbox.username}{" "}
                <span className="text-muted-foreground font-normal">
                  @{mailbox.username}
                </span>
              </p>
            ) : eligible.length === 0 ? (
              <div className="border-border bg-surface-sunken space-y-2 rounded-md border px-3 py-2.5">
                <p className="text-muted-foreground text-sm">
                  {t("adminMail.formNoAccounts")}
                </p>
                <Link
                  href="/admin/users"
                  className="text-primary hover:underline inline-flex items-center gap-1 text-sm font-medium"
                >
                  {t("adminMail.formNoAccountsLink")}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            ) : (
              <Select
                value={userId}
                onValueChange={setUserId}
                disabled={pending}
              >
                <SelectTrigger
                  id="mailbox-account"
                  aria-label={t("adminMail.formAccount")}
                >
                  <SelectValue
                    placeholder={t("adminMail.formAccountPlaceholder")}
                  >
                    {selectedAccount
                      ? `${selectedAccount.full_name || selectedAccount.username} (@${selectedAccount.username})`
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.full_name || account.username} (@
                      {account.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="mailbox-email">{t("adminMail.formEmail")}</Label>
                <InfoTip>{t("adminMail.formEmailHelp")}</InfoTip>
              </div>
              <Input
                id="mailbox-email"
                type="email"
                autoComplete="off"
                placeholder={t("adminMail.formEmailPlaceholder")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="mailbox-name">
                  {t("adminMail.formDisplayName")}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({t("adminMail.formOptional")})
                  </span>
                </Label>
                <InfoTip>{t("adminMail.formDisplayNameHelp")}</InfoTip>
              </div>
              <Input
                id="mailbox-name"
                placeholder={t("adminMail.formDisplayNamePlaceholder")}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={pending}
                maxLength={120}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mailbox-provider">
              {t("adminMail.formProvider")}
            </Label>
            <Select
              value={provider}
              onValueChange={pickProvider}
              disabled={pending}
            >
              <SelectTrigger
                id="mailbox-provider"
                aria-label={t("adminMail.formProvider")}
              >
                {/* Shown explicitly: the option labels are only registered
                    once the menu has been opened, so a bare value would leak
                    through as raw text ("custom") until then. */}
                <SelectValue>
                  {provider === CUSTOM_PROVIDER
                    ? t("adminMail.formProviderCustom")
                    : SMTP_PRESETS.find((item) => item.id === provider)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SMTP_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PROVIDER}>
                  {t("adminMail.formProviderCustom")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="mailbox-host">{t("adminMail.formHost")}</Label>
                <InfoTip>{t("adminMail.formHostHelp")}</InfoTip>
              </div>
              <Input
                id="mailbox-host"
                autoComplete="off"
                placeholder={t("adminMail.formHostPlaceholder")}
                value={host}
                onChange={(event) => {
                  setHost(event.target.value);
                  setProvider(CUSTOM_PROVIDER);
                }}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mailbox-port">{t("adminMail.formPort")}</Label>
              <Input
                id="mailbox-port"
                inputMode="numeric"
                placeholder="587"
                value={port}
                onChange={(event) => {
                  setPort(event.target.value);
                  setProvider(CUSTOM_PROVIDER);
                }}
                disabled={pending}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mailbox-security">
              {t("adminMail.formSecurity")}
            </Label>
            <Select
              value={security}
              onValueChange={(value) => {
                setSecurity(value as SmtpSecurity);
                setProvider(CUSTOM_PROVIDER);
              }}
              disabled={pending}
            >
              <SelectTrigger
                id="mailbox-security"
                aria-label={t("adminMail.formSecurity")}
              >
                <SelectValue>{t(SMTP_SECURITY_KEYS[security])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SMTP_SECURITY_KEYS) as SmtpSecurity[]).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {t(SMTP_SECURITY_KEYS[value])}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="mailbox-username">
                  {t("adminMail.formUsername")}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({t("adminMail.formOptional")})
                  </span>
                </Label>
                <InfoTip>{t("adminMail.formUsernameHelp")}</InfoTip>
              </div>
              <Input
                id="mailbox-username"
                autoComplete="off"
                placeholder={email.trim() || t("adminMail.formEmailPlaceholder")}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="mailbox-password">
                  {t("adminMail.formPassword")}
                </Label>
                <InfoTip>
                  {editing
                    ? `${t("adminMail.formPasswordKeep")} ${t("adminMail.formPasswordHelp")}`
                    : t("adminMail.formPasswordHelp")}
                </InfoTip>
              </div>
              <PasswordInput
                id="mailbox-password"
                autoComplete="new-password"
                placeholder={t("adminMail.formPasswordPlaceholder")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                required={!editing}
              />
            </div>
          </div>

          <div className="flex w-fit items-center gap-1">
            <label className="hover:bg-surface-hover flex w-fit cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors duration-150">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={pending}
                className="accent-primary focus-visible:ring-ring size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
              />
              {t("adminMail.formEnabled")}
            </label>
            {/* Sibling, not nested in the label: an inner <button> would also
             * toggle the checkbox on click, since browsers forward a label
             * click to any control inside it. */}
            <InfoTip>{t("adminMail.formEnabledHelp")}</InfoTip>
          </div>

          {checkFailure !== null ? (
            <div
              role="alert"
              className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
            >
              <p className="font-semibold">{t("adminMail.notSavedTitle")}</p>
              <div className="mt-1">
                <MailError raw={checkFailure} />
              </div>
            </div>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {!valid && !pending && saveDisabledReason ? (
            <p className="text-muted-foreground -mb-1 text-right text-xs">
              {saveDisabledReason}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? t("adminMail.checking") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  mailbox,
  onClose,
  onSaved,
}: {
  mailbox: AdminMailbox;
  onClose: () => void;
  onSaved: (mailbox: AdminMailbox) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      const saved = await api.put<AdminMailbox>(
        `/api/v1/admin-mail/mailboxes/${mailbox.id}/password`,
        { password },
      );
      toast.success(t("adminMail.passwordSaved"));
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "mail_auth_failed"
          ? t("adminMail.passwordRejected")
          : apiErrorText(err, "adminMail.saveError"),
      );
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
        title={t("adminMail.updatePasswordTitle", { email: mailbox.email })}
        description={t("adminMail.updatePasswordDescription")}
      >
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-mailbox-password">
              {t("adminMail.newPassword")}
            </Label>
            <PasswordInput
              id="new-mailbox-password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
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
              onClick={onClose}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!password || pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("adminMail.updatePassword")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

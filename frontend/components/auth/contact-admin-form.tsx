"use client";

import { ArrowLeft, CircleCheck, Loader2, MailWarning, Send } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { AdminRequestKind, ContactDelivery } from "@/types/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 2000;

const KINDS: { value: AdminRequestKind; labelKey: string }[] = [
  { value: "account", labelKey: "contactAdmin.kindAccount" },
  { value: "password_reset", labelKey: "contactAdmin.kindPasswordReset" },
  { value: "other", labelKey: "contactAdmin.kindOther" },
];

interface Result {
  delivery: ContactDelivery;
  email: string;
  name: string;
  username: string;
  kind: AdminRequestKind;
}

/** A red asterisk; the input's own `required` is what assistive tech reads. */
function RequiredMark() {
  return (
    <span aria-hidden className="text-danger font-semibold">
      *
    </span>
  );
}

function OptionalNote() {
  const { t } = useTranslation();
  return (
    <span className="text-muted-foreground font-normal">
      ({t("contactAdmin.optional")})
    </span>
  );
}

/**
 * The public "contact an administrator" form. Shown to people who cannot sign
 * in, so it cannot assume anything about who they are.
 */
export function ContactAdminForm({
  onBackToSignIn,
  onSentChange,
}: {
  /** Shown as the main action once the request has been sent. */
  onBackToSignIn?: () => void;
  /** Told when the form switches to (or back from) its "sent" screen, so the
   * page around it can drop its own heading and back link. */
  onSentChange?: (sent: boolean) => void;
} = {}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AdminRequestKind>("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot: real people never see or fill this field, bots fill everything.
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // A password reset is about an account that already exists, so its username
  // identifies the requester on its own - a separate display name adds
  // nothing an admin needs and is one more field to fill in for no reason.
  const isPasswordReset = kind === "password_reset";
  const emailInvalid = email.trim().length > 0 && !EMAIL_PATTERN.test(email.trim());
  const valid =
    (isPasswordReset ? username.trim().length > 0 : name.trim().length > 0) &&
    EMAIL_PATTERN.test(email.trim()) &&
    message.length <= MAX_MESSAGE;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const trimmedUsername = username.trim();
      // Stands in for the name on a password reset, where only the username
      // is collected - the account it names is who the request is about.
      const displayName = isPasswordReset ? trimmedUsername : name.trim();
      const response = await api.post<{ delivery: ContactDelivery }>(
        "/api/v1/contact-admin",
        {
          kind,
          requester_name: displayName,
          requester_email: email.trim(),
          requester_username: trimmedUsername || null,
          message: message.trim(),
          website,
        },
      );
      setResult({
        delivery: response.delivery,
        email: email.trim(),
        name: displayName,
        username: trimmedUsername,
        kind,
      });
      onSentChange?.(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? t("contactAdmin.rateLimited")
          : t("contactAdmin.error"),
      );
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setResult(null);
    onSentChange?.(false);
    setName("");
    setEmail("");
    setUsername("");
    setMessage("");
    setKind("account");
  }

  if (result) {
    const delivered = result.delivery === "sent";
    const rows: [string, string][] = [
      [t("contactAdmin.summaryType"), t(KINDS.find((item) => item.value === result.kind)?.labelKey ?? "")],
      result.kind === "password_reset"
        ? [t("contactAdmin.summaryUsername"), result.username]
        : [t("contactAdmin.summaryName"), result.name],
      [t("contactAdmin.summaryEmail"), result.email],
    ];
    return (
      <div
        role="status"
        ref={(node) => node?.focus({ preventScroll: true })}
        tabIndex={-1}
        className="flex flex-col items-center text-center outline-none"
      >
        {/* A soft halo around the check, in the success tokens, so it reads as
            "done" at a glance and follows light and dark themes. */}
        <span className="bg-success-bg text-success ring-success/10 flex size-16 items-center justify-center rounded-full ring-8">
          <CircleCheck aria-hidden className="size-8" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">
          {t("contactAdmin.successTitle")}
        </h2>
        <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
          {t("contactAdmin.successBody")}
        </p>

        <dl className="border-border bg-surface mt-6 w-full divide-y rounded-xl border text-left text-sm shadow-sm">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3 px-4 py-2.5"
            >
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="min-w-0 font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {/* Deliberately calm: the request is safe in the administrators'
            Inbox either way, so this is only a nudge to let them know. */}
        {!delivered ? (
          <div className="border-warning/30 bg-warning-bg text-warning mt-4 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs">
            <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {t("contactAdmin.deliveryProblemTitle")}
              </p>
              <p className="mt-0.5">
                {result.delivery === "no_mailbox"
                  ? t("contactAdmin.noMailboxBody")
                  : t("contactAdmin.deliveryProblemBody")}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex w-full flex-col gap-2">
          {onBackToSignIn ? (
            <Button type="button" variant="primary" onClick={onBackToSignIn}>
              <ArrowLeft aria-hidden />
              {t("contactAdmin.backToSignIn")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={reset}>
            {t("contactAdmin.sendAnother")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="contact-kind">{t("contactAdmin.kind")}</Label>
        <Select
          value={kind}
          onValueChange={(value) => setKind(value as AdminRequestKind)}
          disabled={pending}
        >
          <SelectTrigger id="contact-kind" aria-label={t("contactAdmin.kind")}>
            <SelectValue>
              {t(KINDS.find((item) => item.value === kind)?.labelKey ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {t(item.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isPasswordReset ? (
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">
            {t("contactAdmin.name")} <RequiredMark />
          </Label>
          <Input
            id="contact-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            maxLength={120}
            required
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="contact-email">
          {t("contactAdmin.email")} <RequiredMark />
        </Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          maxLength={320}
          aria-invalid={emailInvalid || undefined}
          required
        />
        {emailInvalid ? (
          <p className="text-danger text-xs">{t("contactAdmin.emailInvalid")}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("contactAdmin.emailHelp")}
          </p>
        )}
      </div>

      {kind !== "account" ? (
        <div className="space-y-1.5">
          <Label htmlFor="contact-username">
            {t("contactAdmin.username")}{" "}
            {isPasswordReset ? <RequiredMark /> : <OptionalNote />}
          </Label>
          <Input
            id="contact-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={pending}
            maxLength={64}
            required={isPasswordReset}
          />
          <p className="text-muted-foreground text-xs">
            {isPasswordReset
              ? t("contactAdmin.usernameHelpRequired")
              : t("contactAdmin.usernameHelp")}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">
          {t("contactAdmin.message")} <OptionalNote />
        </Label>
        <Textarea
          id="contact-message"
          rows={5}
          placeholder={t("contactAdmin.messagePlaceholder")}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={pending}
          maxLength={MAX_MESSAGE}
        />
      </div>

      {/* Off-screen rather than display:none, which many bots skip. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={!valid || pending}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        {pending ? t("contactAdmin.sending") : t("contactAdmin.submit")}
      </Button>
    </form>
  );
}

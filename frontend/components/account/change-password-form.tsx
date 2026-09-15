"use client";

import { Check, Copy, KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { User } from "@/types/api";

const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_LENGTH = 20;
const LOWERCASE = "abcdefghjkmnpqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%*+-_";
const ALL_PASSWORD_CHARS = LOWERCASE + UPPERCASE + NUMBERS + SYMBOLS;

function randomCharacter(characters: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return characters[values[0]! % characters.length]!;
}

function generatePassword() {
  const required = [
    randomCharacter(LOWERCASE),
    randomCharacter(UPPERCASE),
    randomCharacter(NUMBERS),
    randomCharacter(SYMBOLS),
  ];
  const remaining = Array.from(
    { length: PASSWORD_LENGTH - required.length },
    () => randomCharacter(ALL_PASSWORD_CHARS),
  );

  return [...required, ...remaining]
    .sort(() => {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0]! % 2 === 0 ? -1 : 1;
    })
    .join("");
}

function passwordStrength(password: string) {
  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (password.length >= 16 && categories >= 3) return "Strong";
  if (password.length >= 12 && categories >= 2) return "Good";
  return "Use a stronger password";
}

function passwordRules(t: (key: string) => string) {
  return (password: string, confirmation: string) =>
    [
      { label: t("password.ruleMinLength"), met: password.length >= MIN_PASSWORD_LENGTH },
      { label: t("password.ruleCase"), met: /[A-Z]/.test(password) && /[a-z]/.test(password) },
      { label: t("password.ruleNumberOrSymbol"), met: /\d/.test(password) || /[^A-Za-z0-9]/.test(password) },
      { label: t("password.ruleMatch"), met: Boolean(confirmation) && password === confirmation },
    ];
}

export function ChangePasswordForm({ onCancel, onSuccess }: { onCancel?: () => void; onSuccess?: () => void } = {}) {
  const router = useRouter();
  const { t, apiErrorText } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [generated, setGenerated] = useState(false);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const strengthKey = next ? passwordStrength(next) : null;
  const strength = strengthKey
    ? t(
        strengthKey === "Strong"
          ? "password.strengthStrong"
          : strengthKey === "Good"
            ? "password.strengthGood"
            : "password.strengthWeak",
      )
    : null;
  const strengthClass = strengthKey === "Strong"
    ? "text-success"
    : strengthKey === "Good"
      ? "text-primary"
      : "text-danger";
  const rules = passwordRules(t)(next, confirm);
  const hasValidNewPassword = rules.slice(0, 3).every((rule) => rule.met);
  const canSubmit = Boolean(current) && hasValidNewPassword && rules[3]!.met;

  function fillGeneratedPassword() {
    const password = generatePassword();
    setNext(password);
    setConfirm(password);
    setGenerated(true);
    setError(null);
    toast.success(t("password.generatedToast"));
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(next);
      toast.success(t("password.copiedToast"));
    } catch {
      toast.error(t("password.copyFailedToast"));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasValidNewPassword || next !== confirm) {
      setError(t("password.requirementsNotMet"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post<User>("/api/v1/users/me/password", {
        current_password: current,
        new_password: next,
      });
      toast.success(t("password.passwordChanged"));
      setCurrent("");
      setNext("");
      setConfirm("");
      setGenerated(false);
      onSuccess?.();
      router.refresh();
    } catch (err) {
      setError(apiErrorText(err, "password.couldNotChangePassword"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl" noValidate>
      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="border-border bg-surface-sunken/60 rounded-lg border p-5">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{t("password.requirements")}</p>
          <p className="text-muted-foreground mt-2 text-xs leading-5">{t("password.requirementsHint")}</p>
          <ul className="mt-4 space-y-3" aria-live="polite">
            {rules.map((rule) => (
              <li key={rule.label} className={rule.met ? "text-foreground flex gap-2 text-sm leading-5" : "text-muted-foreground flex gap-2 text-sm leading-5"}>
                {rule.met ? <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden /> : <X className={newPasswordFocused || next || confirm ? "text-danger mt-0.5 size-4 shrink-0" : "text-muted-foreground/50 mt-0.5 size-4 shrink-0"} aria-hidden />}
                <span>{rule.label}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div>
          <section className="space-y-1.5">
            <Label htmlFor="current-password">{t("password.currentPassword")}</Label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={pending}
              required
            />
          </section>

          <section className="border-border mt-8 border-t pt-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{t("password.newPassword")}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{t("password.newPasswordHint")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {generated && next ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void copyPassword()}><Copy />{t("password.copy")}</Button> : null}
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={fillGeneratedPassword}><Sparkles />{t("password.generatePassword")}</Button>
              </div>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="next-password">{t("password.newPassword")}</Label>
                <PasswordInput
                  id="next-password"
                  autoComplete="new-password"
                  value={next}
                  onFocus={() => setNewPasswordFocused(true)}
                  onBlur={() => setNewPasswordFocused(false)}
                  onChange={(event) => { setNext(event.target.value); setGenerated(false); }}
                  disabled={pending}
                  aria-invalid={newPasswordFocused && !hasValidNewPassword}
                  required
                />
                {strength ? <p className="text-muted-foreground text-xs">{t("password.strengthLabel")} <span className={`font-medium ${strengthClass}`}>{strength}</span></p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">{t("password.confirmPassword")}</Label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => { setConfirm(event.target.value); setGenerated(false); }}
                  disabled={pending}
                  aria-invalid={mismatch || undefined}
                  required
                />
                {mismatch ? <p className="text-danger text-xs">{t("password.mismatch")}</p> : null}
              </div>
            </div>
          </section>

          {error ? <p role="alert" className="border-danger/30 bg-danger/10 text-danger mt-6 rounded-md border px-3 py-2 text-sm">{error}</p> : null}
        </div>
      </div>

      <footer className="border-border mt-8 flex flex-wrap justify-end gap-2 border-t pt-5">
        {onCancel ? <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>{t("common.cancel")}</Button> : null}
        <Button type="submit" variant="primary" disabled={pending || !canSubmit}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {t("password.changePassword")}
        </Button>
      </footer>
    </form>
  );
}

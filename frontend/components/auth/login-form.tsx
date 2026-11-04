"use client";

import { AlertCircle, AlertTriangle, ArrowRight, Loader2, Lock, User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PrivacyConsentDialog } from "@/components/auth/privacy-consent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { LoginResponse } from "@/types/api";

export function LoginForm({ siteName = "WikiHub" }: { siteName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const accountInactive = errorCode === "account_inactive";

  /**
   * Only same-origin relative paths are honoured, so a crafted
   * `?next=https://evil.example` cannot turn the login page into an open
   * redirect.
   */
  function safeNextPath(): string {
    const next = searchParams.get("next");
    if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
    return next;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(false);
  }

  /** Declining the policy means no sign-in: nothing was ever sent to accept it. */
  function declineConsent() {
    setConsentOpen(false);
    setPassword("");
    setErrorCode("privacy_consent_declined");
    setError(t("auth.privacyConsentDeclined"));
  }

  async function submit(acceptPrivacy: boolean) {
    setPending(true);
    setError(null);
    setErrorCode(null);

    try {
      // The response also sets the httpOnly session cookie; the body is only
      // used to confirm success. The token is never stored in JS.
      await api.post<LoginResponse>("/api/v1/auth/login", {
        username: username.trim(),
        password,
        ...(acceptPrivacy ? { accept_privacy: true } : {}),
      });

      // `refresh` re-runs the server components so the shell renders with the
      // new session instead of the signed-out cache.
      router.replace(safeNextPath());
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "privacy_consent_required") {
        // Credentials were right but the policy is not accepted yet. Keep them
        // in state and ask; no session exists until the user accepts.
        setConsentOpen(true);
        setPending(false);
        return;
      }
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorCode(err.code);
      } else {
        setError(t("auth.networkError"));
      }
      setConsentOpen(false);
      setPassword("");
      setPending(false);
    }
  }

  return (
    <>
    <form
      onSubmit={handleSubmit}
      className="space-y-3.5 [@media(max-height:800px)]:space-y-2.5"
      noValidate
    >
      <div className="space-y-1 sm:space-y-1.5">
        <label htmlFor="username" className="text-foreground text-xs sm:text-sm font-medium">
          {t("auth.usernameLabel")}
        </label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          leadingIcon={<User className="size-4 text-muted-foreground/80" aria-hidden="true" />}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={pending}
          placeholder="username"
          className="h-10 sm:h-10.5 rounded-lg border-border/80 bg-surface shadow-2xs hover:border-border-strong focus-visible:border-primary focus-visible:ring-primary/20 text-sm"
        />
      </div>

      <div className="space-y-1 sm:space-y-1.5">
        <label htmlFor="password" className="text-foreground text-xs sm:text-sm font-medium">
          {t("auth.passwordLabel")}
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          leadingIcon={<Lock className="size-4 text-muted-foreground/80" aria-hidden="true" />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          placeholder="••••••••"
          className="h-10 sm:h-10.5 rounded-lg border-border/80 bg-surface shadow-2xs hover:border-border-strong focus-visible:border-primary focus-visible:ring-primary/20 text-sm"
        />
      </div>

      {error ? (
        <div
          role="alert"
          className={
            accountInactive
              ? "border-warning/30 bg-warning-bg text-warning flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs sm:text-sm"
              : "border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs sm:text-sm"
          }
        >
          {accountInactive ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="leading-snug">{error}</span>
        </div>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        className="h-10 sm:h-10.5 w-full rounded-lg font-medium shadow-sm transition-all duration-150 active:scale-[0.99] mt-0.5 sm:mt-1"
        disabled={pending || !username || !password}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t("auth.signingIn")}</span>
          </>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <span>{t("auth.signIn")}</span>
            <ArrowRight className="size-4 opacity-75" aria-hidden="true" />
          </span>
        )}
      </Button>
    </form>
    <PrivacyConsentDialog
      open={consentOpen}
      siteName={siteName}
      pending={pending}
      onAccept={() => void submit(true)}
      onDecline={declineConsent}
    />
    </>
  );
}

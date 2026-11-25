"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { RecoveryCodesPanel } from "@/components/account/recovery-codes-panel";
import { PrivacyConsentDialog } from "@/components/auth/privacy-consent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpCodeInput } from "@/components/ui/otp-code-input";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { generateQrSvg } from "@/lib/qr-svg";
import {
  confirmTwoFactor,
  setupTwoFactor,
  verifyTwoFactor,
} from "@/lib/two-factor";
import type { LoginResponse, TwoFactorSetupResponse } from "@/types/api";

type LoginStep = "credentials" | "verify" | "forced-setup" | "forced-recovery";

export function LoginForm({ siteName = "WikiHub" }: { siteName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [step, setStep] = useState<LoginStep>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  // 2FA challenge / forced-setup state
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);

  const accountInactive = errorCode === "account_inactive";

  const otpauthUri = setupData?.otpauth_uri ?? null;
  const qrSvg = useMemo(() => {
    if (!otpauthUri) return null;
    try {
      return generateQrSvg(otpauthUri, { size: 176 });
    } catch {
      return null;
    }
  }, [otpauthUri]);

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

  function completeSignIn() {
    // `refresh` re-runs the server components so the shell renders with the
    // new session instead of the signed-out cache.
    router.replace(safeNextPath());
    router.refresh();
  }

  function resetToCredentials() {
    setStep("credentials");
    setChallengeToken(null);
    setTotpCode("");
    setUseRecovery(false);
    setSetupData(null);
    setRecoveryCodes([]);
    setRecoveryDownloaded(false);
    setPassword("");
    setError(null);
    setErrorCode(null);
    setPending(false);
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

  async function beginForcedSetup(token: string) {
    setStep("forced-setup");
    setSetupData(null);
    setTotpCode("");
    setSetupLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const setup = await setupTwoFactor(token);
      setSetupData(setup);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorCode(err.code);
      } else {
        setError(t("twoFactor.setupError"));
      }
    } finally {
      setSetupLoading(false);
    }
  }

  async function submit(acceptPrivacy: boolean) {
    setPending(true);
    setError(null);
    setErrorCode(null);

    try {
      // The response also sets the httpOnly session cookie; the body is only
      // used to confirm success or start a 2FA challenge/setup step.
      const res = await api.post<LoginResponse>("/api/v1/auth/login", {
        username: username.trim(),
        password,
        ...(acceptPrivacy ? { accept_privacy: true } : {}),
      });

      setConsentOpen(false);

      if (res?.requires_2fa && res.challenge_token) {
        setChallengeToken(res.challenge_token);
        setPassword("");
        setPending(false);
        if (res.requires_2fa_setup) {
          await beginForcedSetup(res.challenge_token);
        } else {
          setTotpCode("");
          setUseRecovery(false);
          setStep("verify");
        }
        return;
      }

      completeSignIn();
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

  async function submitVerify(codeToVerify: string) {
    const trimmed = codeToVerify.trim();
    if (!challengeToken || !trimmed || pending) return;
    setPending(true);
    setError(null);
    setErrorCode(null);
    try {
      await verifyTwoFactor(challengeToken, trimmed);
      completeSignIn();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorCode(err.code);
      } else {
        setError(t("twoFactor.verifyError"));
      }
      setPending(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitVerify(totpCode);
  }

  async function submitForcedConfirm(codeToConfirm: string) {
    const trimmed = codeToConfirm.trim();
    if (!challengeToken || !trimmed || pending) return;
    setPending(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await confirmTwoFactor(trimmed, challengeToken);
      setRecoveryCodes(res.recovery_codes);
      setRecoveryDownloaded(false);
      setStep("forced-recovery");
      setPending(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorCode(err.code);
      } else {
        setError(t("twoFactor.confirmError"));
      }
      setPending(false);
    }
  }

  async function handleForcedConfirmSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForcedConfirm(totpCode);
  }

  async function handleCopySecret() {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      toast.success(t("twoFactor.secretCopied"));
      window.setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      toast.error(t("errors.network"));
    }
  }

  if (step === "verify") {
    return (
      <form
        onSubmit={(e) => void handleVerifySubmit(e)}
        className="space-y-3.5"
        noValidate
      >
        <div className="border-border/80 bg-surface-sunken/70 flex items-start gap-2.5 rounded-lg border p-3">
          <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-foreground text-xs sm:text-sm font-semibold">
              {t("twoFactor.loginVerifyTitle")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {useRecovery
                ? t("twoFactor.loginVerifyRecoveryDescription")
                : t("twoFactor.loginVerifyDescription")}
            </p>
          </div>
        </div>

        <div className="space-y-1 sm:space-y-1.5">
          <label
            htmlFor="totp-verify-code"
            className="text-foreground text-xs sm:text-sm font-medium"
          >
            {useRecovery ? t("twoFactor.recoveryCodeLabel") : t("twoFactor.codeLabel")}
          </label>
          {useRecovery ? (
            <Input
              id="totp-verify-code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              leadingIcon={<KeyRound className="size-4 text-muted-foreground/80" aria-hidden="true" />}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              disabled={pending}
              placeholder={t("twoFactor.recoveryCodePlaceholder")}
              className="h-10 sm:h-10.5 rounded-lg border-border/80 bg-surface shadow-2xs hover:border-border-strong focus-visible:border-primary focus-visible:ring-primary/20 font-mono text-sm tracking-wider"
            />
          ) : (
            <OtpCodeInput
              id="totp-verify-code"
              name="code"
              autoFocus
              required
              value={totpCode}
              onChange={setTotpCode}
              onComplete={(code) => void submitVerify(code)}
              disabled={pending}
            />
          )}
        </div>

        {error ? (
          <div
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs sm:text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="leading-snug">{error}</span>
          </div>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="h-10 sm:h-10.5 w-full rounded-lg font-medium shadow-sm"
          disabled={pending || !totpCode.trim()}
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>{t("twoFactor.verifying")}</span>
            </>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <span>{t("twoFactor.verifySignIn")}</span>
              <ArrowRight className="size-4 opacity-75" aria-hidden="true" />
            </span>
          )}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setUseRecovery((prev) => !prev);
              setTotpCode("");
              setError(null);
            }}
            className="text-primary hover:text-primary-hover h-8 px-2 text-xs"
          >
            {useRecovery
              ? t("twoFactor.useAuthenticatorCode")
              : t("twoFactor.useRecoveryCode")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToCredentials}
            className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2 text-xs"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t("twoFactor.backToSignIn")}
          </Button>
        </div>
      </form>
    );
  }

  if (step === "forced-setup") {
    return (
      <div className="space-y-3.5">
        <div className="border-primary/30 bg-primary-subtle/60 flex items-start gap-2.5 rounded-lg border p-3">
          <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-foreground text-xs sm:text-sm font-semibold">
              {t("twoFactor.loginForcedTitle")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {t("twoFactor.loginForcedDescription")}
            </p>
          </div>
        </div>

        {setupLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs sm:text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t("twoFactor.setupLoading")}</span>
          </div>
        ) : setupData ? (
          <form
            onSubmit={(e) => void handleForcedConfirmSubmit(e)}
            className="space-y-3"
            noValidate
          >
            {qrSvg ? (
              <div className="flex justify-center">
                <div
                  className="border-border inline-block rounded-lg border bg-white p-2 shadow-2xs"
                  aria-label={t("twoFactor.qrAlt")}
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <p className="text-muted-foreground text-xs font-medium">
                {t("twoFactor.manualKeyLabel")}
              </p>
              <div className="border-border bg-surface-sunken flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                <code className="text-foreground font-mono text-xs break-all select-all">
                  {setupData.secret}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCopySecret()}
                  className="h-7 shrink-0 px-2 text-xs"
                >
                  {secretCopied ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {t("twoFactor.copySecret")}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="totp-forced-code"
                className="text-foreground text-xs sm:text-sm font-medium"
              >
                {t("twoFactor.codeLabel")}
              </label>
              <OtpCodeInput
                id="totp-forced-code"
                name="code"
                required
                value={totpCode}
                onChange={setTotpCode}
                onComplete={(code) => void submitForcedConfirm(code)}
                disabled={pending}
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="leading-snug">{error}</span>
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="h-10 w-full rounded-lg font-medium shadow-sm"
              disabled={pending || !totpCode.trim()}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>{t("twoFactor.verifying")}</span>
                </>
              ) : (
                t("twoFactor.verifyAndEnable")
              )}
            </Button>
          </form>
        ) : error ? (
          <div
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="leading-snug">{error}</span>
          </div>
        ) : null}

        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToCredentials}
            className="text-muted-foreground hover:text-foreground h-8 gap-1.5 text-xs"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t("twoFactor.backToSignIn")}
          </Button>
        </div>
      </div>
    );
  }

  if (step === "forced-recovery") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-foreground text-sm sm:text-base font-semibold">
            {t("twoFactor.recoveryTitle")}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {t("twoFactor.recoveryDescription")}
          </p>
        </div>

        <RecoveryCodesPanel
          codes={recoveryCodes}
          siteName={siteName}
          onDownloaded={() => setRecoveryDownloaded(true)}
        />

        {!recoveryDownloaded ? (
          <p className="text-muted-foreground text-center text-xs">
            {t("twoFactor.downloadRequiredHint")}
          </p>
        ) : null}

        <Button
          type="button"
          variant="primary"
          className="h-10 w-full rounded-lg font-medium shadow-sm"
          disabled={!recoveryDownloaded}
          onClick={completeSignIn}
        >
          <span className="flex items-center justify-center gap-2">
            <span>{t("twoFactor.continueToApp", { siteName })}</span>
            <ArrowRight className="size-4 opacity-75" aria-hidden="true" />
          </span>
        </Button>
      </div>
    );
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

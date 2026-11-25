"use client";

import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { RecoveryCodesPanel } from "@/components/account/recovery-codes-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpCodeInput } from "@/components/ui/otp-code-input";
import { PasswordInput } from "@/components/ui/password-input";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import { generateQrSvg } from "@/lib/qr-svg";
import {
  confirmTwoFactor,
  disableTwoFactor,
  getTwoFactorStatus,
  reconfigureTwoFactor,
  regenerateRecoveryCodes,
  setupTwoFactor,
} from "@/lib/two-factor";
import type { TwoFactorSetupResponse, TwoFactorStatus } from "@/types/api";

export function TwoFactorPanel() {
  const { t, locale, apiErrorText } = useTranslation();

  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Setup / Reconfigure QR modal state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<"enable" | "reconfigure">("enable");
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  // Reconfigure step-1 (verify current credentials) modal state
  const [reconfigureOpen, setReconfigureOpen] = useState(false);
  const [reconfigurePassword, setReconfigurePassword] = useState("");
  const [reconfigureCode, setReconfigureCode] = useState("");
  const [reconfigureUseRecovery, setReconfigureUseRecovery] = useState(false);
  const [reconfigurePending, setReconfigurePending] = useState(false);
  const [reconfigureError, setReconfigureError] = useState<string | null>(null);

  // One-time recovery codes modal state (shared by enable & regenerate)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);

  // Regenerate modal state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenCode, setRegenCode] = useState("");
  const [regenPending, setRegenPending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Disable modal state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableUseRecovery, setDisableUseRecovery] = useState(false);
  const [disablePending, setDisablePending] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getTwoFactorStatus();
      setStatus(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorText(err, "twoFactor.loadError"));
    } finally {
      setLoading(false);
    }
  }, [apiErrorText]);

  useEffect(() => {
    let cancelled = false;
    getTwoFactorStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(apiErrorText(err, "twoFactor.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiErrorText]);

  const otpauthUri = setupData?.otpauth_uri ?? null;
  const qrSvg = useMemo(() => {
    if (!otpauthUri) return null;
    try {
      return generateQrSvg(otpauthUri, { size: 192 });
    } catch {
      return null;
    }
  }, [otpauthUri]);

  async function openSetup() {
    setSetupMode("enable");
    setSetupOpen(true);
    setSetupData(null);
    setSetupError(null);
    setSetupCode("");
    setSetupLoading(true);
    try {
      const res = await setupTwoFactor();
      setSetupData(res);
    } catch (err) {
      setSetupError(apiErrorText(err, "twoFactor.setupError"));
    } finally {
      setSetupLoading(false);
    }
  }

  async function submitStartReconfigure(codeToUse: string) {
    const trimmed = codeToUse.trim();
    if (!reconfigurePassword || !trimmed || reconfigurePending) return;
    setReconfigurePending(true);
    setReconfigureError(null);
    try {
      const res = await reconfigureTwoFactor(reconfigurePassword, trimmed);
      setReconfigureOpen(false);
      setReconfigurePassword("");
      setReconfigureCode("");
      setReconfigureUseRecovery(false);
      setSetupMode("reconfigure");
      setSetupData(res);
      setSetupError(null);
      setSetupCode("");
      setSetupLoading(false);
      setSetupOpen(true);
    } catch (err) {
      setReconfigureError(apiErrorText(err, "twoFactor.reconfigureError"));
    } finally {
      setReconfigurePending(false);
    }
  }

  async function handleStartReconfigure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitStartReconfigure(reconfigureCode);
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

  async function submitConfirmSetup(codeToConfirm: string) {
    const trimmed = codeToConfirm.trim();
    if (!trimmed || confirmPending) return;
    setConfirmPending(true);
    setSetupError(null);
    try {
      const res = await confirmTwoFactor(trimmed);
      setSetupOpen(false);
      setSetupCode("");
      setSetupData(null);
      setRecoveryDownloaded(false);
      setRecoveryCodes(res.recovery_codes);
      toast.success(
        setupMode === "reconfigure"
          ? t("twoFactor.reconfiguredToast")
          : t("twoFactor.enabledToast"),
      );
      await refreshStatus();
    } catch (err) {
      setSetupError(apiErrorText(err, "twoFactor.confirmError"));
    } finally {
      setConfirmPending(false);
    }
  }

  async function handleConfirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitConfirmSetup(setupCode);
  }

  async function submitRegenerate(codeToUse: string) {
    const trimmed = codeToUse.trim();
    if (!regenPassword || !trimmed || regenPending) return;
    setRegenPending(true);
    setRegenError(null);
    try {
      const res = await regenerateRecoveryCodes(regenPassword, trimmed);
      setRegenOpen(false);
      setRegenPassword("");
      setRegenCode("");
      setRecoveryDownloaded(false);
      setRecoveryCodes(res.recovery_codes);
      toast.success(t("twoFactor.regeneratedToast"));
      await refreshStatus();
    } catch (err) {
      setRegenError(apiErrorText(err, "twoFactor.regenerateError"));
    } finally {
      setRegenPending(false);
    }
  }

  async function handleRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitRegenerate(regenCode);
  }

  async function submitDisable(codeToUse: string) {
    const trimmed = codeToUse.trim();
    if (!disablePassword || !trimmed || disablePending) return;
    setDisablePending(true);
    setDisableError(null);
    try {
      const next = await disableTwoFactor(disablePassword, trimmed);
      setStatus(next);
      setDisableOpen(false);
      setDisablePassword("");
      setDisableCode("");
      setDisableUseRecovery(false);
      toast.success(t("twoFactor.disabledToast"));
    } catch (err) {
      setDisableError(apiErrorText(err, "twoFactor.disableError"));
    } finally {
      setDisablePending(false);
    }
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDisable(disableCode);
  }

  const lowRecoveryCodes =
    Boolean(status?.enabled) && (status?.recovery_codes_remaining ?? 0) <= 2;

  return (
    <>
      <div className="border-border border-t p-5">
        <div className="flex items-start gap-4">
          <span className="bg-surface-sunken text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
            <Smartphone className="size-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{t("twoFactor.title")}</h3>
                  {loading ? (
                    <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />
                  ) : status ? (
                    <>
                      <Badge variant={status.enabled ? "success" : "neutral"}>
                        {status.enabled
                          ? t("twoFactor.statusEnabled")
                          : t("twoFactor.statusDisabled")}
                      </Badge>
                      {status.enforced ? (
                        <Badge variant="info">{t("twoFactor.enforcedBadge")}</Badge>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <p className="text-muted-foreground mt-1 text-sm">
                  {t("twoFactor.description")}
                </p>
              </div>

              {!loading && status && !status.enabled ? (
                <div className="shrink-0">
                  <Button variant="primary" size="sm" onClick={() => void openSetup()}>
                    <ShieldCheck className="size-4" aria-hidden />
                    {t("twoFactor.enableButton")}
                  </Button>
                </div>
              ) : null}
            </div>

            {loadError ? (
              <p role="alert" className="text-danger mt-2 flex items-center gap-1.5 text-xs">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                {loadError}
              </p>
            ) : null}

            {!loading && status?.enabled ? (
              <div className="border-border/70 bg-surface-sunken/60 mt-3.5 flex flex-col gap-3 rounded-lg border px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {status.enabled_at ? (
                      <span className="text-muted-foreground">
                        {t("twoFactor.enabledSince", {
                          date: formatDateTime(status.enabled_at, locale),
                        })}
                      </span>
                    ) : null}
                    {status.enabled_at ? (
                      <span className="text-border-strong select-none" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    <span
                      className={
                        lowRecoveryCodes ? "text-warning font-medium" : "text-muted-foreground"
                      }
                    >
                      {lowRecoveryCodes
                        ? t("twoFactor.recoveryCodesLow", {
                            count: status.recovery_codes_remaining,
                          })
                        : t("twoFactor.recoveryCodesRemaining", {
                            count: status.recovery_codes_remaining,
                          })}
                    </span>
                  </div>
                  {status.enforced ? (
                    <p className="text-muted-foreground">
                      {t("twoFactor.enforcedDisableHint")}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setReconfigureError(null);
                      setReconfigurePassword("");
                      setReconfigureCode("");
                      setReconfigureUseRecovery(false);
                      setReconfigureOpen(true);
                    }}
                  >
                    <QrCode className="size-3.5" aria-hidden />
                    {t("twoFactor.reconfigureButton")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRegenError(null);
                      setRegenPassword("");
                      setRegenCode("");
                      setRegenOpen(true);
                    }}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    {t("twoFactor.regenerateButton")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={status.enforced}
                    title={status.enforced ? t("twoFactor.enforcedDisableHint") : undefined}
                    onClick={() => {
                      setDisableError(null);
                      setDisablePassword("");
                      setDisableCode("");
                      setDisableUseRecovery(false);
                      setDisableOpen(true);
                    }}
                    className="text-danger not-disabled:hover:bg-danger-bg not-disabled:hover:text-danger"
                  >
                    <ShieldOff className="size-3.5" aria-hidden />
                    {t("twoFactor.disableButton")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Enable / Reconfigure 2FA QR Dialog */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent
          title={
            setupMode === "reconfigure"
              ? t("twoFactor.reconfigureTitle")
              : t("twoFactor.setupTitle")
          }
          description={
            setupMode === "reconfigure"
              ? t("twoFactor.reconfigureConfirmDescription")
              : t("twoFactor.setupDescription")
          }
          className="max-w-md"
        >
          {setupLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("twoFactor.setupLoading")}
            </div>
          ) : setupData ? (
            <form onSubmit={(e) => void handleConfirmSetup(e)} className="space-y-4">
              {qrSvg ? (
                <div className="flex justify-center">
                  <div
                    className="border-border inline-block rounded-lg border bg-white p-2.5 shadow-2xs"
                    aria-label={t("twoFactor.qrAlt")}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label className="text-xs">{t("twoFactor.manualKeyLabel")}</Label>
                <div className="border-border bg-surface-sunken flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <code className="text-foreground font-mono text-xs break-all select-all">
                    {setupData.secret}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCopySecret()}
                    className="shrink-0"
                  >
                    {secretCopied ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {t("twoFactor.copySecret")}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="two-factor-setup-code">{t("twoFactor.codeLabel")}</Label>
                <OtpCodeInput
                  id="two-factor-setup-code"
                  value={setupCode}
                  onChange={setSetupCode}
                  onComplete={(code) => void submitConfirmSetup(code)}
                  disabled={confirmPending}
                  required
                />
              </div>

              {setupError ? (
                <p
                  role="alert"
                  className="border-danger/30 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{setupError}</span>
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={confirmPending}
                  onClick={() => setSetupOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={confirmPending || !setupCode.trim()}
                >
                  {confirmPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t("twoFactor.verifying")}
                    </>
                  ) : (
                    t("twoFactor.verifyAndEnable")
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : setupError ? (
            <div className="space-y-4">
              <p
                role="alert"
                className="border-danger/30 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{setupError}</span>
              </p>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setSetupOpen(false)}>
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* One-time Recovery Codes Dialog */}
      <Dialog
        open={Boolean(recoveryCodes)}
        onOpenChange={(open) => {
          if (!open && recoveryDownloaded) setRecoveryCodes(null);
        }}
      >
        <DialogContent
          title={t("twoFactor.recoveryTitle")}
          description={t("twoFactor.recoveryDescription")}
          className="max-w-md"
        >
          {recoveryCodes ? (
            <RecoveryCodesPanel
              codes={recoveryCodes}
              onDownloaded={() => setRecoveryDownloaded(true)}
            />
          ) : null}
          {!recoveryDownloaded ? (
            <p className="text-muted-foreground text-xs">
              {t("twoFactor.downloadRequiredHint")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="primary"
              disabled={!recoveryDownloaded}
              onClick={() => setRecoveryCodes(null)}
            >
              {t("twoFactor.doneButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconfigure 2FA Step 1 (Verify current credentials) Dialog */}
      <Dialog open={reconfigureOpen} onOpenChange={setReconfigureOpen}>
        <DialogContent
          title={t("twoFactor.reconfigureTitle")}
          description={t("twoFactor.reconfigureDescription")}
          className="max-w-md"
        >
          <form onSubmit={(e) => void handleStartReconfigure(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="two-factor-reconfigure-password">
                {t("twoFactor.currentPasswordLabel")}
              </Label>
              <PasswordInput
                id="two-factor-reconfigure-password"
                autoComplete="current-password"
                value={reconfigurePassword}
                onChange={(e) => setReconfigurePassword(e.target.value)}
                disabled={reconfigurePending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="two-factor-reconfigure-code">
                  {reconfigureUseRecovery
                    ? t("twoFactor.recoveryCodeLabel")
                    : t("twoFactor.codeLabel")}
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setReconfigureUseRecovery((prev) => !prev);
                    setReconfigureCode("");
                    setReconfigureError(null);
                  }}
                  className="text-primary hover:underline cursor-pointer text-xs font-medium"
                >
                  {reconfigureUseRecovery
                    ? t("twoFactor.useAuthenticatorApp")
                    : t("twoFactor.useRecoveryCode")}
                </button>
              </div>
              {reconfigureUseRecovery ? (
                <Input
                  id="two-factor-reconfigure-code"
                  autoComplete="one-time-code"
                  placeholder={t("twoFactor.recoveryCodePlaceholder")}
                  value={reconfigureCode}
                  onChange={(e) => setReconfigureCode(e.target.value)}
                  disabled={reconfigurePending}
                  required
                />
              ) : (
                <OtpCodeInput
                  id="two-factor-reconfigure-code"
                  value={reconfigureCode}
                  onChange={setReconfigureCode}
                  onComplete={(code) => void submitStartReconfigure(code)}
                  disabled={reconfigurePending}
                  required
                />
              )}
            </div>

            {reconfigureError ? (
              <p
                role="alert"
                className="border-danger/30 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{reconfigureError}</span>
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={reconfigurePending}
                onClick={() => setReconfigureOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  reconfigurePending || !reconfigurePassword || !reconfigureCode.trim()
                }
              >
                {reconfigurePending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t("twoFactor.verifying")}
                  </>
                ) : (
                  <>
                    <QrCode className="size-4" aria-hidden />
                    {t("twoFactor.reconfigureVerifyButton")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Regenerate Recovery Codes Dialog */}
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent
          title={t("twoFactor.regenerateTitle")}
          description={t("twoFactor.regenerateDescription")}
          className="max-w-md"
        >
          <form onSubmit={(e) => void handleRegenerate(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="two-factor-regen-password">
                {t("twoFactor.currentPasswordLabel")}
              </Label>
              <PasswordInput
                id="two-factor-regen-password"
                autoComplete="current-password"
                value={regenPassword}
                onChange={(e) => setRegenPassword(e.target.value)}
                disabled={regenPending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="two-factor-regen-code">{t("twoFactor.codeLabel")}</Label>
              <OtpCodeInput
                id="two-factor-regen-code"
                value={regenCode}
                onChange={setRegenCode}
                onComplete={(code) => void submitRegenerate(code)}
                disabled={regenPending}
                required
              />
            </div>

            {regenError ? (
              <p
                role="alert"
                className="border-danger/30 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{regenError}</span>
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={regenPending}
                onClick={() => setRegenOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={regenPending || !regenPassword || !regenCode.trim()}
              >
                {regenPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t("twoFactor.regenerating")}
                  </>
                ) : (
                  <>
                    <KeyRound className="size-3.5" aria-hidden />
                    {t("twoFactor.regenerateConfirm")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent
          title={t("twoFactor.disableTitle")}
          description={t("twoFactor.disableDescription")}
          className="max-w-md"
        >
          <form onSubmit={(e) => void handleDisable(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="two-factor-disable-password">
                {t("twoFactor.currentPasswordLabel")}
              </Label>
              <PasswordInput
                id="two-factor-disable-password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                disabled={disablePending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="two-factor-disable-code">
                  {disableUseRecovery
                    ? t("twoFactor.recoveryCodeLabel")
                    : t("twoFactor.codeLabel")}
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setDisableUseRecovery((prev) => !prev);
                    setDisableCode("");
                    setDisableError(null);
                  }}
                  className="text-primary hover:underline cursor-pointer text-xs font-medium"
                >
                  {disableUseRecovery
                    ? t("twoFactor.useAuthenticatorApp")
                    : t("twoFactor.useRecoveryCode")}
                </button>
              </div>
              {disableUseRecovery ? (
                <Input
                  id="two-factor-disable-code"
                  autoComplete="one-time-code"
                  placeholder={t("twoFactor.recoveryCodePlaceholder")}
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  disabled={disablePending}
                  required
                />
              ) : (
                <OtpCodeInput
                  id="two-factor-disable-code"
                  value={disableCode}
                  onChange={setDisableCode}
                  onComplete={(code) => void submitDisable(code)}
                  disabled={disablePending}
                  required
                />
              )}
            </div>

            {disableError ? (
              <p
                role="alert"
                className="border-danger/30 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{disableError}</span>
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={disablePending}
                onClick={() => setDisableOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={disablePending || !disablePassword || !disableCode.trim()}
              >
                {disablePending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t("twoFactor.disabling")}
                  </>
                ) : (
                  t("twoFactor.disableConfirm")
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

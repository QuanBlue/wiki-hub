"use client";

import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { downloadRecoveryCodes, formatRecoveryCodesText } from "@/lib/two-factor";

export function RecoveryCodesPanel({
  codes,
  siteName = "WikiHub",
  onDownloaded,
}: {
  codes: string[];
  siteName?: string;
  onDownloaded?: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  async function handleCopyAll() {
    try {
      await navigator.clipboard.writeText(formatRecoveryCodesText(codes, siteName));
      setCopied(true);
      toast.success(t("twoFactor.codesCopied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("errors.network"));
    }
  }

  function handleDownload() {
    downloadRecoveryCodes(codes, siteName);
    setDownloaded(true);
    onDownloaded?.();
  }

  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="border-warning/40 bg-warning-bg text-warning flex items-start gap-2.5 rounded-lg border p-3 text-xs leading-relaxed"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("twoFactor.recoveryOnceWarning")}</span>
      </div>

      <div className="border-border bg-surface-sunken grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-sm">
        {codes.map((code) => (
          <div
            key={code}
            className="border-border/70 bg-surface text-foreground rounded border px-2.5 py-1.5 text-center tracking-wider select-all"
          >
            {code}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyAll()}>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {t("twoFactor.copyAllCodes")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={handleDownload}>
          {downloaded ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          {t("twoFactor.downloadCodes")}
        </Button>
      </div>
    </div>
  );
}

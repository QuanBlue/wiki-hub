"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  Printer,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Wordmark } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useThemeSettings } from "@/components/theme-color-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import { ApiError, api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { formatDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { PublicShareView } from "@/types/api";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default function PublicSharePage({ params }: PageProps) {
  const { t, locale } = useTranslation();
  const themeSettings = useThemeSettings();
  const effectiveSiteName = themeSettings?.siteName || "WikiHub";

  const [token, setToken] = useState<string | null>(null);
  const [shareData, setShareData] = useState<PublicShareView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Password state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [copied, setCopied] = useState(false);
  // Shared documents default to the full viewport width, like the page view.
  const [fullWidth, setFullWidth] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((resolved) => {
      if (active) setToken(resolved.token);
    });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    async function load() {
      setLoading(true);
      setErrorStatus(null);
      setErrorMessage(null);
      try {
        const data = await api.get<PublicShareView>(
          `/api/v1/public/shares/${encodeURIComponent(token ?? "")}`,
        );
        if (active) {
          setShareData(data);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message);
        } else {
          setErrorStatus(500);
          setErrorMessage("Failed to load document");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || verifying) return;
    setVerifying(true);
    setPasswordError(null);
    try {
      const data = await api.post<PublicShareView>(
        `/api/v1/public/shares/${encodeURIComponent(token ?? "")}/verify`,
        { password: password.trim() },
      );
      setShareData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPasswordError(t("publicViewer.invalidPassword"));
      } else if (err instanceof ApiError) {
        setPasswordError(err.message);
      } else {
        setPasswordError(t("publicViewer.invalidPassword"));
      }
    } finally {
      setVerifying(false);
    }
  }

  function handleCopy() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success(t("publicViewer.copied"));
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  const renderHeader = () => (
    <header className="h-topbar topbar-on-primary sticky top-0 z-30 w-full print:hidden">
      <div className="topbar-inner flex h-full items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex items-center rounded-md px-1.5 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={t("topbar.homeAria", { siteName: effectiveSiteName })}
          >
            <Wordmark siteName={effectiveSiteName} nameClassName="max-sm:sr-only" />
          </Link>
          <span className="text-muted-foreground opacity-60">•</span>
          <span className="border-border bg-surface-hover text-foreground inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium">
            {t("publicViewer.readOnlyBadge")}
          </span>
          {shareData?.expires_at ? (
            <div className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
              <Calendar className="size-3.5" />
              <span>
                {t("publicViewer.expiresOn", {
                  date: formatDate(shareData.expires_at, locale),
                })}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {shareData && (!shareData.has_password || shareData.is_password_verified) ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFullWidth((value) => !value)}
                className="h-8 gap-1.5 text-xs"
                aria-pressed={fullWidth}
                title={fullWidth ? t("workspace.normalWidth") : t("workspace.fullWidth")}
              >
                {fullWidth ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
                <span className="hidden sm:inline">
                  {fullWidth ? t("workspace.normalWidth") : t("workspace.fullWidth")}
                </span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-8 gap-1.5 text-xs"
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span className="hidden sm:inline">{t("publicViewer.copyLink")}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handlePrint}
                className="h-8 gap-1.5 text-xs"
              >
                <Printer className="size-3.5" />
                <span className="hidden sm:inline">{t("publicViewer.print")}</span>
              </Button>
            </>
          ) : null}

          <ThemeToggle />
          <LanguageToggle />
        </div>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col text-foreground">
        {renderHeader()}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-2xl space-y-4 animate-pulse">
            <div className="h-8 bg-surface-hover rounded-md w-1/3" />
            <div className="h-12 bg-surface-hover rounded-md w-3/4" />
            <div className="h-64 bg-surface-hover rounded-md w-full" />
          </div>
        </div>
      </div>
    );
  }

  // Error states: disabled, expired, or not found
  if (errorStatus !== null || !shareData) {
    const isForbidden = errorStatus === 403;
    const isExpired =
      errorStatus === 410 ||
      (errorMessage && errorMessage.toLowerCase().includes("expired"));

    return (
      <div className="min-h-screen bg-background flex flex-col text-foreground">
        {renderHeader()}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="border-border bg-surface w-full max-w-md rounded-xl border p-6 text-center space-y-4 shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
              {isForbidden ? (
                <ShieldAlert className="size-6" />
              ) : (
                <AlertCircle className="size-6" />
              )}
            </div>

            <div className="space-y-1.5">
              <h1 className="text-foreground text-lg font-semibold">
                {isForbidden
                  ? t("publicViewer.disabledTitle")
                  : isExpired
                    ? t("publicViewer.expiredTitle")
                    : t("publicViewer.notFoundTitle")}
              </h1>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {isForbidden
                  ? t("publicViewer.disabledDesc")
                  : isExpired
                    ? t("publicViewer.expiredDesc")
                    : t("publicViewer.notFoundDesc")}
              </p>
            </div>

            <div className="pt-2">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-xs">
                  {t("publicViewer.backToHome")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Password prompt state
  if (shareData.has_password && !shareData.is_password_verified) {
    return (
      <div className="min-h-screen bg-background flex flex-col text-foreground">
        {renderHeader()}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="border-border bg-surface w-full max-w-md rounded-xl border p-6 space-y-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="border-primary/20 bg-primary-subtle text-primary flex size-10 items-center justify-center rounded-lg border shrink-0">
                <Lock className="size-5" />
              </div>
              <div>
                <h1 className="text-foreground text-base font-semibold">
                  {t("publicViewer.passwordTitle")}
                </h1>
                <p className="text-muted-foreground text-xs">
                  {shareData.title}
                </p>
              </div>
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("publicViewer.passwordDesc")}
            </p>

            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="share-password"
                  className="text-foreground text-xs font-medium"
                >
                  {t("publicViewer.passwordLabel")}
                </label>
                <div className="relative">
                  <Input
                    id="share-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    placeholder={t("publicViewer.passwordPlaceholder")}
                    autoFocus
                    required
                    className="pr-9 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="hover:bg-accent hover:text-accent-foreground text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {passwordError ? (
                  <p className="text-danger text-xs mt-1" role="alert">
                    {passwordError}
                  </p>
                ) : null}
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full text-xs font-semibold"
                disabled={verifying || !password.trim()}
              >
                {verifying ? t("share.creatingLink") : t("publicViewer.unlockButton")}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Unlocked / Public Document View
  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground selection:bg-primary/20">
      {renderHeader()}

      {/* Main Document Content Column */}
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 py-8 sm:px-8 sm:py-12",
          fullWidth ? "max-w-none" : "max-w-4xl",
        )}
      >
        <div
          className={cn(
            "space-y-6",
            // Shrink to the content (e.g. a fixed-width table) and centre it, so
            // the title block lines up with the body instead of the viewport edge.
            fullWidth && "mx-auto w-fit max-w-full min-w-[min(100%,48rem)]",
          )}
        >
          {/* Metadata & Title Header */}
          <div className="border-border pb-6 border-b space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {shareData.space_name}
              </span>
              <span>({shareData.space_key})</span>
              <span>•</span>
              <span>
                {locale === "vi" ? "Cập nhật lúc" : "Updated"}{" "}
                {formatDate(shareData.updated_at, locale)}
              </span>
              {shareData.view_count > 0 ? (
                <>
                  <span>•</span>
                  <span>{t("publicViewer.views", { count: shareData.view_count })}</span>
                </>
              ) : null}
            </div>

            <h1 className="text-foreground text-2xl sm:text-3xl font-bold tracking-tight">
              {shareData.title}
            </h1>
          </div>

          {/* Document Content Render */}
          <div className="prose prose-neutral dark:prose-invert max-w-none pt-2 [&_.tableWrapper_table]:mx-auto">
            <RichTextContent
              content={shareData.content_html}
              exportMode={true}
              canEditAttachments={false}
            />
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-border mt-auto border-t py-6 text-center text-xs text-muted-foreground print:hidden">
        <p>
          {effectiveSiteName} • {t("publicViewer.readOnlyBadge")}
        </p>
      </footer>
    </div>
  );
}

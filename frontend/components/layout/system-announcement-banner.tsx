"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  Loader2,
  Pencil,
  PowerOff,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { RichTextContent } from "@/components/pages/rich-text-editor";
import { useSystemAnnouncement } from "@/components/layout/system-announcement-provider";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { AnnouncementLevel, SiteSettings, SystemAnnouncement } from "@/types/api";

const DISMISSED_STORAGE_KEY = "wikihub:dismissed-announcement";

const LEVEL_STYLES: Record<
  AnnouncementLevel,
  {
    container: string;
    iconColor: string;
    badgeBg: string;
    buttonHover: string;
    actionBtn: string;
    Icon: typeof Info;
  }
> = {
  info: {
    container: "bg-info-bg border-info/40 text-info shadow-xs",
    iconColor: "text-info",
    badgeBg: "bg-info/10 text-info border-info/30",
    buttonHover: "hover:bg-info/15 active:bg-info/25 text-info",
    actionBtn: "border-info/30 bg-surface/75 text-info hover:bg-surface hover:border-info/50 shadow-2xs",
    Icon: Volume2,
  },
  warning: {
    container: "bg-warning-bg border-warning/45 text-warning shadow-xs",
    iconColor: "text-warning",
    badgeBg: "bg-warning/10 text-warning border-warning/35",
    buttonHover: "hover:bg-warning/15 active:bg-warning/25 text-warning",
    actionBtn: "border-warning/30 bg-surface/75 text-warning hover:bg-surface hover:border-warning/50 shadow-2xs",
    Icon: AlertTriangle,
  },
  danger: {
    container: "bg-danger-bg border-danger/45 text-danger shadow-xs",
    iconColor: "text-danger",
    badgeBg: "bg-danger/10 text-danger border-danger/35",
    buttonHover: "hover:bg-danger/15 active:bg-danger/25 text-danger",
    actionBtn: "border-danger/30 bg-surface/75 text-danger hover:bg-surface hover:border-danger/50 shadow-2xs",
    Icon: AlertCircle,
  },
  success: {
    container: "bg-success-bg border-success/40 text-success shadow-xs",
    iconColor: "text-success",
    badgeBg: "bg-success/10 text-success border-success/30",
    buttonHover: "hover:bg-success/15 active:bg-success/25 text-success",
    actionBtn: "border-success/30 bg-surface/75 text-success hover:bg-surface hover:border-success/50 shadow-2xs",
    Icon: CheckCircle2,
  },
};

function stripHtmlText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function isAnnouncementActiveAt(
  announcement: SystemAnnouncement | null | undefined,
  nowMs: number,
): boolean {
  if (!announcement || !announcement.enabled) return false;
  const hasTitle = Boolean(announcement.title && announcement.title.trim());
  const hasBody =
    Boolean(stripHtmlText(announcement.content_html || "")) ||
    /<img\b/i.test(announcement.content_html || "");
  if (!hasTitle && !hasBody) return false;

  if (announcement.starts_at) {
    const startMs = Date.parse(announcement.starts_at);
    if (Number.isFinite(startMs) && nowMs < startMs) return false;
  }
  if (announcement.expires_at) {
    const endMs = Date.parse(announcement.expires_at);
    if (Number.isFinite(endMs) && nowMs >= endMs) return false;
  }
  return true;
}

export function SystemAnnouncementBanner({
  announcement: propAnnouncement,
  isAdmin: propIsAdmin,
  previewMode = false,
  className,
}: {
  announcement?: SystemAnnouncement | null;
  isAdmin?: boolean;
  previewMode?: boolean;
  className?: string;
} = {}) {
  const context = useSystemAnnouncement();
  const announcement =
    propAnnouncement !== undefined ? propAnnouncement : context.announcement;
  const isAdmin = propIsAdmin !== undefined ? propIsAdmin : context.isAdmin;
  const router = useRouter();
  const { locale } = useTranslation();
  const isVi = locale === "vi";

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [locallyDisabled, setLocallyDisabled] = useState(false);
  const contentWrapRef = useRef<HTMLDivElement>(null);

  const signature = useMemo(() => {
    if (!announcement) return "";
    return (
      announcement.updated_at ||
      `${announcement.level}:${announcement.title ?? ""}:${announcement.content_html}:${announcement.starts_at ?? ""}:${announcement.expires_at ?? ""}`
    );
  }, [announcement]);

  useEffect(() => {
    setLocallyDisabled(false);
  }, [signature]);

  useEffect(() => {
    if (previewMode || typeof window === "undefined") return;
    try {
      setDismissedKey(window.localStorage.getItem(DISMISSED_STORAGE_KEY));
    } catch {
      // Ignore storage access errors in restricted browsing contexts.
    }
  }, [previewMode, signature]);

  // Periodically re-check start/expiry boundaries so an announcement expires
  // on screen without needing a page reload.
  useEffect(() => {
    if (previewMode || !announcement) return;
    if (!announcement.starts_at && !announcement.expires_at) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [announcement, previewMode]);

  useEffect(() => {
    const el = contentWrapRef.current;
    if (!el) return;
    const checkOverflow = () => {
      setIsOverflowing(el.scrollHeight > 84);
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [announcement?.content_html, expanded]);

  if (!announcement || locallyDisabled) return null;

  const hasTitle = Boolean(announcement.title?.trim());
  const hasBody =
    Boolean(stripHtmlText(announcement.content_html || "")) ||
    /<img\b/i.test(announcement.content_html || "");
  const hasContent = hasTitle || hasBody;

  if (!previewMode) {
    if (!isAnnouncementActiveAt(announcement, nowMs)) return null;
    if (announcement.dismissible && dismissedKey && dismissedKey === signature) {
      return null;
    }
  }

  const style = LEVEL_STYLES[announcement.level] ?? LEVEL_STYLES.info;
  const Icon = style.Icon;

  function handleDismiss() {
    if (!announcement?.dismissible || previewMode) return;
    setDismissedKey(signature);
    try {
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, signature);
    } catch {
      // Ignore storage errors.
    }
  }

  async function handleQuickDisable() {
    if (!announcement || disabling || previewMode) return;
    setDisabling(true);
    try {
      await api.patch<SiteSettings>("/api/v1/settings", {
        announcement: {
          ...announcement,
          enabled: false,
        },
      });
      setLocallyDisabled(true);
      toast.success(
        isVi ? "Đã tắt thông báo hệ thống." : "System announcement turned off.",
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : isVi
            ? "Không thể tắt thông báo."
            : "Could not turn off the announcement.",
      );
    } finally {
      setDisabling(false);
    }
  }

  return (
    <div
      role={announcement.level === "danger" || announcement.level === "warning" ? "alert" : "status"}
      aria-label={isVi ? "Thông báo hệ thống" : "System announcement"}
      className={cn(
        "relative border-b px-4 py-2.5 text-[13px] leading-normal transition-colors sm:px-6",
        style.container,
        className,
      )}
    >
      <div className="flex w-full items-center gap-3">
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", style.iconColor)}
        />

        <div className="min-w-0 flex-1">
          {!hasContent && previewMode ? (
            <p className="m-0 italic leading-snug opacity-80">
              {isVi
                ? "Nhập tiêu đề hoặc nội dung bên dưới — thanh thông báo trên cùng sẽ hiển thị như thế này."
                : "Type a headline or message below — your top announcement bar will look like this."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {hasTitle ? (
                <p className="m-0 font-semibold leading-snug text-foreground">
                  {announcement.title}
                </p>
              ) : null}

              {hasBody ? (
                <div
                  ref={contentWrapRef}
                  className={cn(
                    "wikihub-announcement-content text-foreground/95 min-w-0 overflow-hidden transition-[max-height] duration-200",
                    !expanded && isOverflowing && "max-h-16 mask-b-from-75%",
                  )}
                >
                  <RichTextContent content={announcement.content_html} exportMode />
                </div>
              ) : null}
            </div>
          )}

          {isOverflowing ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className={cn(
                "focus-visible:ring-ring mt-0.5 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                style.iconColor,
                style.buttonHover,
              )}
            >
              {expanded ? (
                <>
                  <ChevronUp aria-hidden className="size-3.5" />
                  {isVi ? "Thu gọn" : "Show less"}
                </>
              ) : (
                <>
                  <ChevronDown aria-hidden className="size-3.5" />
                  {isVi ? "Xem thêm" : "Show more"}
                </>
              )}
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          {announcement.expires_at ? (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium md:inline-flex",
                style.badgeBg,
              )}
            >
              <Clock aria-hidden className="size-3" />
              {isVi ? "Đến" : "Until"}{" "}
              {formatDateTime(announcement.expires_at, locale)}
            </span>
          ) : null}

          {isAdmin && !previewMode ? (
            <>
              <Link
                href="/admin/settings?tab=announcement"
                title={isVi ? "Chỉnh sửa thông báo" : "Edit announcement"}
                className={cn(
                  "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  style.actionBtn,
                )}
              >
                <Pencil aria-hidden className="size-3.5" />
                <span className="hidden sm:inline">
                  {isVi ? "Sửa" : "Edit"}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void handleQuickDisable()}
                disabled={disabling}
                title={isVi ? "Tắt thông báo này" : "Turn off announcement"}
                className={cn(
                  "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                  style.actionBtn,
                )}
              >
                {disabling ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <PowerOff aria-hidden className="size-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isVi ? "Tắt" : "Turn off"}
                </span>
              </button>
            </>
          ) : null}

          {announcement.dismissible ? (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={isVi ? "Đóng thông báo" : "Dismiss announcement"}
              title={isVi ? "Tạm ẩn thông báo này" : "Dismiss announcement"}
              className={cn(
                "focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                style.buttonHover,
              )}
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Check, ImageUp, Loader2, LogIn, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { LoginShowcase } from "@/components/auth/login-showcase";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { translate, type Locale } from "@/lib/i18n/core";
import {
  defaultLoginPanelText,
  emptyLoginPanelCopy,
  LOGIN_FEATURE_ICONS,
  resolveLoginPanel,
} from "@/lib/login-panel";
import { cn } from "@/lib/utils";
import type { LoginPanel, LoginPanelCopy, LoginPanelFeature, SiteSettings } from "@/types/api";

/** Backend limits (`schemas/site_settings.py`); keep in step. */
const LIMITS = { tagline: 120, headline: 160, subheading: 600, footer: 200, title: 80, description: 240 };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Width the panel is laid out at before being scaled down into the preview frame. */
const PREVIEW_WIDTH = 1100;
const PREVIEW_HEIGHT = 680;

const LANGUAGES: Array<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "vi", label: "Tiếng Việt" },
];

export function LoginPanelSettings({
  value,
  onChange,
  imageUrl,
  onImageUrlChange,
  hasUploadedImage,
  siteName,
  pending,
  dirty,
}: {
  value: LoginPanel;
  onChange: (next: LoginPanel) => void;
  /** URL of the uploaded illustration, if there is one. */
  imageUrl: string | null;
  onImageUrlChange: (url: string | null) => void;
  hasUploadedImage: boolean;
  siteName: string;
  pending: boolean;
  dirty: boolean;
}) {
  const { locale } = useTranslation();
  const vi = locale === "vi";
  const L = (en: string, viText: string) => (vi ? viText : en);

  const [lang, setLang] = useState<Locale>(locale);
  const [confirmReset, setConfirmReset] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const copy = value[lang];
  const defaults = defaultLoginPanelText((key) => translate(lang, key));
  const enabledCount = copy.features.filter((feature) => feature.enabled).length;

  function setCopy(patch: Partial<LoginPanelCopy>) {
    onChange({ ...value, [lang]: { ...copy, ...patch } });
  }

  function setFeature(index: number, patch: Partial<LoginPanelFeature>) {
    setCopy({
      features: copy.features.map((feature, i) => (i === index ? { ...feature, ...patch } : feature)),
    });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error(L("Use a JPEG, PNG or WebP image.", "Hãy dùng ảnh JPEG, PNG hoặc WebP."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(L("The image must be 5 MB or smaller.", "Ảnh phải nhỏ hơn hoặc bằng 5 MB."));
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const updated = await api.post<SiteSettings>("/api/v1/settings/login-image", undefined, {
        rawBody: body,
      });
      onImageUrlChange(updated.effective.login_image_url ?? null);
      // Uploading implies the admin wants to see it.
      if (value.hide_image) onChange({ ...value, hide_image: false });
      toast.success(L("Illustration uploaded.", "Đã tải ảnh minh hoạ lên."));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : L("Could not upload the image.", "Không tải được ảnh."));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveImage() {
    setUploading(true);
    try {
      await api.delete<SiteSettings>("/api/v1/settings/login-image");
      onImageUrlChange(null);
      toast.success(L("Uploaded illustration removed.", "Đã xoá ảnh minh hoạ đã tải lên."));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : L("Could not remove the image.", "Không xoá được ảnh."));
    } finally {
      setUploading(false);
    }
  }

  const textField = (
    key: "tagline" | "headline" | "subheading" | "footer",
    label: string,
    multiline = false,
  ) => {
    const current = copy[key] ?? "";
    const common = {
      id: `login-panel-${lang}-${key}`,
      value: current,
      maxLength: LIMITS[key],
      placeholder: defaults[key],
      disabled: pending,
    };
    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={common.id} className="text-foreground text-xs font-medium">
            {label}
          </label>
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {current.length}/{LIMITS[key]}
          </span>
        </div>
        {multiline ? (
          <Textarea
            {...common}
            rows={3}
            onChange={(event) => setCopy({ [key]: event.target.value || null })}
          />
        ) : (
          <Input {...common} onChange={(event) => setCopy({ [key]: event.target.value || null })} />
        )}
      </div>
    );
  };

  return (
    <>
      <div className="border-border bg-surface/98 sticky top-topbar z-20 flex flex-wrap items-center justify-between gap-3 border-b py-3.5 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <LogIn className="text-primary size-5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-foreground text-sm font-semibold sm:text-base">
              {L("Sign-in page", "Trang đăng nhập")}
            </h3>
            <p className="text-muted-foreground mt-0.5 hidden text-xs sm:block">
              {L(
                "Edit the left panel people see before they sign in. Empty fields keep the default text.",
                "Chỉnh panel bên trái mà mọi người thấy trước khi đăng nhập. Ô để trống sẽ dùng chữ mặc định.",
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={pending}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw className="size-3.5" />
            {L("Reset this language", "Đặt lại ngôn ngữ này")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
            disabled={pending || !dirty}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {L("Saving...", "Đang lưu...")}
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                {L("Save", "Lưu")}
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 pt-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <div
            role="tablist"
            aria-label={L("Language to edit", "Ngôn ngữ đang chỉnh")}
            className="border-border bg-surface-sunken inline-flex rounded-lg border p-0.5"
          >
            {LANGUAGES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={lang === id}
                onClick={() => setLang(id)}
                className={cn(
                  "focus-visible:ring-ring cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  lang === id
                    ? "bg-surface text-foreground shadow-2xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3.5">
            {textField("tagline", L("Small line above the headline", "Dòng nhỏ phía trên tiêu đề"))}
            {textField("headline", L("Headline", "Tiêu đề"))}
            {textField("subheading", L("Description", "Mô tả"), true)}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-foreground text-xs font-semibold">
              {L("Feature blurbs", "Ba ô tính năng")}
            </legend>
            {copy.features.map((feature, index) => {
              const onlyEnabled = feature.enabled && enabledCount === 1;
              const base = `login-panel-${lang}-feature-${index}`;
              return (
                <div key={LOGIN_FEATURE_ICONS[index]} className="border-border bg-surface rounded-lg border p-3 shadow-2xs">
                  <label
                    className={cn(
                      "flex w-fit items-center gap-2 text-xs font-medium select-none",
                      onlyEnabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                    )}
                    title={
                      onlyEnabled
                        ? L("Keep at least one blurb enabled.", "Cần giữ ít nhất một ô.")
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={feature.enabled}
                      checked={feature.enabled}
                      disabled={pending || onlyEnabled}
                      onChange={(event) => setFeature(index, { enabled: event.target.checked })}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="bg-border-strong peer-checked:bg-primary peer-focus-visible:ring-ring relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 peer-focus-visible:ring-2"
                    >
                      <span className="bg-surface absolute top-0.5 left-0.5 size-3 rounded-full shadow-sm transition-transform duration-150 peer-checked:translate-x-3" />
                    </span>
                    {L(`Blurb ${index + 1}`, `Ô ${index + 1}`)}
                  </label>
                  <div className={cn("mt-2.5 space-y-2", !feature.enabled && "opacity-50")}>
                    <Input
                      id={`${base}-title`}
                      aria-label={L(`Blurb ${index + 1} title`, `Tiêu đề ô ${index + 1}`)}
                      value={feature.title ?? ""}
                      maxLength={LIMITS.title}
                      placeholder={defaults.features[index].title}
                      disabled={pending || !feature.enabled}
                      onChange={(event) => setFeature(index, { title: event.target.value || null })}
                    />
                    <Textarea
                      id={`${base}-description`}
                      aria-label={L(`Blurb ${index + 1} description`, `Mô tả ô ${index + 1}`)}
                      rows={2}
                      value={feature.description ?? ""}
                      maxLength={LIMITS.description}
                      placeholder={defaults.features[index].description}
                      disabled={pending || !feature.enabled}
                      onChange={(event) =>
                        setFeature(index, { description: event.target.value || null })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </fieldset>

          {textField("footer", L("Footer line", "Dòng chân trang"))}

          <fieldset className="border-border bg-surface space-y-3 rounded-lg border p-3 shadow-2xs">
            <legend className="text-foreground px-1 text-xs font-semibold">
              {L("Illustration", "Ảnh minh hoạ")}
              <span className="text-muted-foreground ml-1.5 font-normal">
                {L("(applies to both languages)", "(dùng cho cả hai ngôn ngữ)")}
              </span>
            </legend>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-medium select-none">
              <input
                type="checkbox"
                role="switch"
                aria-checked={!value.hide_image}
                checked={!value.hide_image}
                disabled={pending}
                onChange={(event) => onChange({ ...value, hide_image: !event.target.checked })}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="bg-border-strong peer-checked:bg-primary peer-focus-visible:ring-ring relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 peer-focus-visible:ring-2"
              >
                <span className="bg-surface absolute top-0.5 left-0.5 size-3 rounded-full shadow-sm transition-transform duration-150 peer-checked:translate-x-3" />
              </span>
              {L("Show an illustration", "Hiển thị ảnh minh hoạ")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                className="sr-only"
                aria-label={L("Upload illustration", "Tải ảnh minh hoạ lên")}
                onChange={(event) => void handleUpload(event)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={pending || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />}
                {hasUploadedImage ? L("Replace image", "Thay ảnh") : L("Upload image", "Tải ảnh lên")}
              </Button>
              {hasUploadedImage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger h-8 gap-1.5 text-xs"
                  disabled={pending || uploading}
                  onClick={() => void handleRemoveImage()}
                >
                  <Trash2 className="size-3.5" />
                  {L("Use the default image", "Dùng ảnh mặc định")}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {L(
                "JPEG, PNG or WebP, up to 5 MB. Wide images (about 16:9) fit best. Uploads apply right away; text changes need Save.",
                "JPEG, PNG hoặc WebP, tối đa 5 MB. Ảnh ngang (khoảng 16:9) hiển thị đẹp nhất. Ảnh áp dụng ngay; chữ cần bấm Lưu.",
              )}
            </p>
          </fieldset>
        </div>

        <div className="xl:sticky xl:top-[calc(var(--wh-topbar-height)+5rem)] xl:self-start">
          <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
            {L("Live preview", "Xem trước trực tiếp")} · {lang === "vi" ? "VI" : "EN"}
          </p>
          <ScaledPreview>
            <LoginShowcase
              preview
              siteName={siteName}
              panel={resolveLoginPanel(value, imageUrl, lang, (key) => translate(lang, key))}
            />
          </ScaledPreview>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={L("Reset this language?", "Đặt lại ngôn ngữ này?")}
        description={L(
          "All text for this language goes back to the built-in default. Nothing is saved until you press Save.",
          "Toàn bộ chữ của ngôn ngữ này trở về mặc định. Chỉ lưu khi bạn bấm Lưu.",
        )}
        confirmLabel={L("Reset", "Đặt lại")}
        cancelLabel={L("Cancel", "Huỷ")}
        onConfirm={() => {
          onChange({ ...value, [lang]: emptyLoginPanelCopy() });
          setConfirmReset(false);
        }}
      />
    </>
  );
}

/** Lays the panel out at desktop size, then scales it to fit the available width. */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(Math.min(1, frame.clientWidth / PREVIEW_WIDTH) || 0.5);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      data-testid="login-panel-preview"
      className="border-border overflow-hidden rounded-xl border shadow-xs"
      style={{ height: PREVIEW_HEIGHT * scale }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none origin-top-left"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

"use client";

import { Download, Loader2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CroppedAvatarImage, type AvatarCrop } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function ProfileImageViewer({
  src,
  kind,
  ownerName,
  ownerUsername,
  updatedAt,
  crop,
  contentType,
  className,
  children,
}: {
  src: string | null | undefined;
  kind: "avatar" | "cover";
  ownerName: string;
  ownerUsername: string;
  updatedAt?: string | null;
  crop?: AvatarCrop | null;
  contentType?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const { t, locale } = useTranslation();
  const [imageSize, setImageSize] = useState<{ src: string; width: number; height: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleImageLoad = useCallback(
    (size: { width: number; height: number }) => {
      if (!src) return;
      setImageSize((prev) =>
        prev && prev.src === src && prev.width === size.width && prev.height === size.height
          ? prev
          : { src, ...size },
      );
    },
    [src],
  );

  if (!src) return <>{children}</>;

  const title = t(kind === "avatar" ? "profile.profilePicture" : "profile.coverPicture");
  const label = t(kind === "avatar" ? "profile.viewAvatar" : "profile.viewCover");

  async function handleDownload() {
    if (!src || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const mimeType =
        blob.type ||
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
        contentType ||
        "";
      const ext = EXTENSION_BY_TYPE[mimeType] ?? "png";
      const safeOwner = (ownerUsername || "user").replace(/[^a-zA-Z0-9_-]/g, "_");
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${safeOwner}-${kind}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error(t("profile.downloadImageError"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "focus-visible:ring-ring block cursor-zoom-in transition-[filter] duration-150 hover:brightness-90 active:brightness-75 focus-visible:z-10 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none",
            className,
          )}
        >
          {children}
        </button>
      </DialogTrigger>
      <DialogContent
        title={title}
        className={kind === "cover" ? "w-full max-w-5xl" : "w-full max-w-2xl"}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <div
              className={cn(
                "bg-surface-sunken ring-border relative overflow-hidden ring-1 ring-inset",
                kind === "cover"
                  ? "aspect-[15/4] w-full rounded-md"
                  : "aspect-square w-[min(24rem,calc(100vw-4.5rem),calc(100vh-12rem))] rounded-md",
              )}
            >
              <CroppedAvatarImage
                src={src}
                alt={title}
                crop={crop}
                contentType={contentType}
                viewportRatio={kind === "cover" ? 15 / 4 : 1}
                onImageLoad={handleImageLoad}
              />
            </div>
          </div>
          <aside className="border-border w-full shrink-0 border-t pt-4 lg:w-56 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            <h3 className="text-foreground text-sm font-semibold">{t("profile.imageDetails")}</h3>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("profile.imageUse")}</dt>
                <dd className="text-foreground mt-1 font-medium">{title}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("profile.imageOwner")}</dt>
                <dd className="text-foreground mt-1 font-medium break-words">{ownerName.trim() || ownerUsername}</dd>
                <dd className="text-muted-foreground break-all">@{ownerUsername}</dd>
              </div>
              {imageSize?.src === src && imageSize.width > 0 ? (
                <div>
                  <dt className="text-muted-foreground">{t("profile.imageDimensions")}</dt>
                  <dd className="text-foreground mt-1 font-medium">{imageSize.width} × {imageSize.height} px</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">{t("profile.imageUpdatedAt")}</dt>
                <dd className="text-foreground mt-1 font-medium">
                  {updatedAt ? formatDateTime(updatedAt, locale) : t("profile.imageDateUnknown")}
                </dd>
              </div>
            </dl>
            <div className="mt-5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={downloading}
                onClick={() => void handleDownload()}
                className="w-full gap-1.5"
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="size-4" aria-hidden />
                )}
                {t("profile.downloadImage")}
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

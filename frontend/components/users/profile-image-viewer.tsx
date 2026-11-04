"use client";

import { useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

export function ProfileImageViewer({
  src,
  kind,
  ownerName,
  ownerUsername,
  updatedAt,
  className,
  children,
}: {
  src: string | null | undefined;
  kind: "avatar" | "cover";
  ownerName: string;
  ownerUsername: string;
  updatedAt?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const { t, locale } = useTranslation();
  const [imageSize, setImageSize] = useState<{ src: string; width: number; height: number } | null>(null);
  if (!src) return <>{children}</>;

  const title = t(kind === "avatar" ? "profile.profilePicture" : "profile.coverPicture");
  const label = t(kind === "avatar" ? "profile.viewAvatar" : "profile.viewCover");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "focus-visible:ring-ring block cursor-zoom-in transition-opacity hover:opacity-85 active:opacity-70 focus-visible:z-10 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none",
            className,
          )}
        >
          {children}
        </button>
      </DialogTrigger>
      <DialogContent
        title={title}
        className={kind === "cover" ? "max-w-6xl" : "w-fit max-w-[calc(100vw-2rem)]"}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <img
              src={src}
              alt={title}
              onLoad={(event) => {
                const image = event.currentTarget;
                setImageSize({ src, width: image.naturalWidth, height: image.naturalHeight });
              }}
              className={
                kind === "cover"
                  ? "block max-h-[calc(100vh-9rem)] max-w-full object-contain"
                  : "block aspect-square w-[min(32rem,calc(100vw-4.5rem),calc(100vh-9rem))] object-contain"
              }
            />
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
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

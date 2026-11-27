"use client";

import { Download, Image as ImageIcon, Maximize2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface ImageContextMenuState {
  x: number;
  y: number;
  src: string;
  alt: string;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

function deriveImageFileName(src: string, alt: string, mimeType?: string): string {
  const extFromMime = mimeType ? MIME_TO_EXT[mimeType.toLowerCase()] : undefined;

  let base = alt.trim();
  if (!base) {
    try {
      const url = new URL(src, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const lastSegment = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (lastSegment && !/^[a-f0-9-]{36}$/i.test(lastSegment)) {
        base = lastSegment;
      }
    } catch {
      // ignore invalid URL
    }
  }
  if (!base) base = "image";

  const cleaned = base.replace(/[^a-zA-Z0-9._\u00C0-\u024F\u1EA0-\u1EF9-]/g, "_");
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}.${extFromMime || "png"}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = objectUrl;
    });

    const width = img.naturalWidth || img.width || 1;
    const height = img.naturalHeight || img.height || 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png", 1.0),
    );
    if (!pngBlob) throw new Error("Failed to encode PNG");
    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ImageContextMenu({
  menu,
  onClose,
  onZoom,
}: {
  menu: ImageContextMenuState | null;
  onClose: () => void;
  onZoom: (image: { src: string; alt: string }) => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleDismiss = (event: Event) => {
      if (event instanceof MouseEvent && menuRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    window.addEventListener("pointerdown", handleDismiss);
    window.addEventListener("keydown", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    return () => {
      window.removeEventListener("pointerdown", handleDismiss);
      window.removeEventListener("keydown", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const left =
    typeof window !== "undefined"
      ? Math.max(8, Math.min(menu.x, window.innerWidth - 224))
      : menu.x;
  const top =
    typeof window !== "undefined"
      ? Math.max(8, Math.min(menu.y, window.innerHeight - 160))
      : menu.y;

  async function handleCopyImage() {
    if (!menu) return;
    const { src, alt } = menu;
    onClose();
    try {
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rawBlob = await response.blob();
      const pngBlob = await blobToPng(rawBlob);

      if (typeof window !== "undefined" && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/png": pngBlob,
            }),
          ]);
          toast.success(t("editor.imageCopied"));
          return;
        } catch (clipErr) {
          console.warn("Clipboard image write failed, falling back to download", clipErr);
        }
      }

      triggerBlobDownload(pngBlob, deriveImageFileName(src, alt, "image/png"));
      toast.success(t("editor.imageSaved"));
    } catch (err) {
      console.error("Failed to copy image", err);
      toast.error(t("editor.imageCopyError"));
    }
  }

  async function handleSaveImage() {
    if (!menu) return;
    const { src, alt } = menu;
    onClose();
    try {
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const fileName = deriveImageFileName(src, alt, blob.type);
      triggerBlobDownload(blob, fileName);
      toast.success(t("editor.imageSaved"));
    } catch (err) {
      console.warn("Fetch download failed, falling back to anchor download", err);
      try {
        const anchor = document.createElement("a");
        anchor.href = src;
        anchor.download = deriveImageFileName(src, alt);
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        toast.success(t("editor.imageSaved"));
      } catch {
        toast.error(t("editor.imageSaveError"));
      }
    }
  }

  function handleZoomImage() {
    if (!menu) return;
    const { src, alt } = menu;
    onClose();
    onZoom({ src, alt });
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("editor.imageOptionsAria")}
      contentEditable={false}
      style={{
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 9999,
      }}
      className={cn(
        "min-w-48 overflow-hidden rounded-lg border border-border p-1.5 shadow-xl select-none",
        "bg-surface-raised text-foreground",
        "animate-in fade-in-0 zoom-in-95 duration-100",
      )}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleCopyImage}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("editor.imageCopy")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={handleZoomImage}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Maximize2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("editor.imageZoom")}</span>
      </button>

      <div className="my-1 border-t border-border" />

      <button
        type="button"
        role="menuitem"
        onClick={handleSaveImage}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("editor.imageSave")}</span>
      </button>
    </div>
  );
}

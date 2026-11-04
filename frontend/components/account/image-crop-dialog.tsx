"use client";

import { Loader2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  cropGeometry,
  cropImageFile,
  drawImageCrop,
  type ImageOffset,
  type ImageSize,
} from "@/lib/image-crop";
import { useTranslation } from "@/lib/i18n/context";

export function ImageCropDialog({
  file,
  kind,
  onApply,
  onClose,
}: {
  file: File;
  kind: "avatar" | "cover";
  onApply: (file: File) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; offset: ImageOffset } | null>(
    null,
  );
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [viewportSize, setViewportSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<ImageOffset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setImageUrl(url);
    };
    image.onerror = () => setError(t("profile.cropLoadError"));
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file, t]);

  useEffect(() => {
    const viewport = viewportElement;
    if (!viewport) return;
    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width && rect.height) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportElement]);

  const geometry =
    imageSize && viewportSize
      ? cropGeometry(imageSize, viewportSize, zoom, offset)
      : null;

  useEffect(() => {
    const canvas = previewRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !geometry || !viewportSize || !imageUrl) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewportSize.width * ratio));
    canvas.height = Math.max(1, Math.round(viewportSize.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    drawImageCrop(context, image, geometry, canvas.width, canvas.height);
  }, [geometry, viewportSize, imageUrl]);

  function moveTo(next: ImageOffset) {
    if (!imageSize || !viewportSize) return;
    const bounds = cropGeometry(imageSize, viewportSize, zoom, next);
    setOffset({ x: bounds.x, y: bounds.y });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!geometry) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offset: { x: geometry.x, y: geometry.y },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    moveTo({
      x: drag.offset.x + event.clientX - drag.x,
      y: drag.offset.y + event.clientY - drag.y,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 1 : 10;
    const direction: Record<string, ImageOffset> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = direction[event.key];
    if (!delta || !geometry) return;
    event.preventDefault();
    moveTo({ x: geometry.x + delta.x, y: geometry.y + delta.y });
  }

  async function apply() {
    if (!imageRef.current || !viewportSize || saving) return;
    setSaving(true);
    setError(null);
    try {
      const cropped = await cropImageFile(
        file,
        imageRef.current,
        viewportSize,
        zoom,
        { x: geometry?.x ?? 0, y: geometry?.y ?? 0 },
        kind,
      );
      if (cropped.size > (kind === "avatar" ? 5 : 10) * 1024 * 1024) {
        setError(
          t(
            kind === "avatar"
              ? "profile.avatarTooLarge"
              : "profile.coverTooLarge",
          ),
        );
        setSaving(false);
        return;
      }
      onApply(cropped);
    } catch {
      setError(t("profile.cropSaveError"));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        title={t(
          kind === "avatar" ? "profile.cropAvatar" : "profile.cropCover",
        )}
        description={t("profile.cropHint")}
        className={kind === "cover" ? "max-w-2xl" : "max-w-md"}
      >
        <div
          ref={setViewportElement}
          role="group"
          tabIndex={0}
          aria-label={t("profile.cropPosition")}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          className={`bg-surface-sunken ring-border hover:ring-border-strong active:ring-primary focus-visible:ring-ring relative mx-auto cursor-grab touch-none overflow-hidden rounded-md ring-1 ring-inset transition-colors focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing ${kind === "avatar" ? "aspect-square w-full max-w-64 rounded-full" : "aspect-[15/4] w-full"}`}
        >
          {geometry && imageUrl ? (
            <canvas
              ref={previewRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full"
            />
          ) : null}
        </div>
        <div className="mt-5 space-y-2">
          <label
            htmlFor="profile-image-zoom"
            className="text-foreground text-sm font-medium"
          >
            {t("profile.cropZoom")}
          </label>
          <input
            id="profile-image-zoom"
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="accent-primary focus-visible:ring-ring h-8 w-full cursor-pointer rounded-md hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none active:opacity-70"
          />
        </div>
        {file.type === "image/gif" ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("profile.cropGifHint")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-danger mt-3 text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
          >
            {t("profile.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void apply()}
            disabled={!geometry || saving}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("profile.cropApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

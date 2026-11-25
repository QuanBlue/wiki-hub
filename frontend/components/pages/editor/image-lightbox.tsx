"use client";

import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const LIGHTBOX_MIN_SCALE = 1;
const LIGHTBOX_MAX_SCALE = 4;
const LIGHTBOX_DOUBLE_CLICK_SCALE = 2.5;

function clampScale(value: number) {
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, value));
}

/**
 * Full-screen click-to-zoom viewer for images in the read-only page content.
 * Wheel and the toolbar buttons zoom continuously; double-click toggles a
 * fixed zoom level for a quick look. Panning only kicks in once zoomed in,
 * so a plain click still reaches the backdrop and closes the viewer.
 */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: { src: string; alt: string } | null;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const { t } = useTranslation();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  // State rather than a ref: the dialog's content mounts a moment after this
  // component does, and the wheel listener has to be attached once it exists.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  // Changing scale from a user gesture (wheel, buttons) also snaps the pan
  // back to centered once fully zoomed out, rather than leaving the image
  // parked off to one side at 1x.
  const applyScale = (updater: (prev: number) => number) => {
    setScale((prev) => {
      const next = clampScale(updater(prev));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  useEffect(() => {
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyScale((prev) => prev - event.deltaY * 0.0015);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [viewport]);

  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.startOffsetX + (event.clientX - drag.startX),
      y: drag.startOffsetY + (event.clientY - drag.startY),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  };

  const closeOnBackdrop = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <Dialog
      open={!!image}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t("editor.imagePreview")}
        onClick={closeOnBackdrop}
        className={cn(
          "flex h-screen max-h-none w-screen max-w-none flex-col",
          "rounded-none border-none bg-black/95 p-0 shadow-none",
          "[&>button[aria-label=Close]]:hidden [&>div:first-child]:sr-only",
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 p-3">
          <p className="truncate pl-1 text-xs text-white/60">
            {image?.alt || t("editor.scrollOrDoubleClickToZoom")}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => applyScale((prev) => prev - 0.5)}
              disabled={scale <= LIGHTBOX_MIN_SCALE}
              aria-label={t("editor.zoomOut")}
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-11 text-center text-xs font-medium text-white/80 tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => applyScale((prev) => prev + 0.5)}
              disabled={scale >= LIGHTBOX_MAX_SCALE}
              aria-label={t("editor.zoomIn")}
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={resetZoom}
              disabled={scale === 1 && offset.x === 0 && offset.y === 0}
              aria-label={t("editor.resetZoom")}
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={t("editor.closeAria")}
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div
          ref={setViewport}
          onClick={closeOnBackdrop}
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-4"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.src}
              alt={image.alt}
              draggable={false}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={() => {
                setScale((prev) =>
                  prev > 1 ? 1 : LIGHTBOX_DOUBLE_CLICK_SCALE,
                );
                setOffset({ x: 0, y: 0 });
              }}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
              className={cn(
                "max-h-full max-w-full touch-none object-contain select-none",
                !isDragging && "transition-transform duration-100",
                scale > 1
                  ? isDragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "",
              )}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  Info,
  Type,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { TOGGLE_ON_CLASS } from "./content-normalize";

function normaliseImageWidth(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 80 ? Math.round(parsed) : null;
}

function normaliseImageAspectRatio(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The width of the editor column an image sits in; a node view is always inside one. */
function editorWidthAround(element: HTMLElement) {
  return (element.closest(".ProseMirror") as HTMLElement).clientWidth;
}

type ImageResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type ImageAlignment = "left" | "center" | "right";
type ImageCrop = { x: number; y: number; width: number; height: number };

/**
 * How far in from either side of an image a pointer press starts a resize.
 * The visible grab bars sit inside this band, and the transparent side
 * handles - which carry the resize cursor - are drawn exactly this wide, so
 * what the cursor promises and what the hit test accepts stay the same thing.
 */
const IMAGE_RESIZE_EDGE_SIZE = 20;

const defaultImageCrop: ImageCrop = {
  x: 0.05,
  y: 0.05,
  width: 0.9,
  height: 0.9,
};

function parseImageCrop(value: unknown): ImageCrop | null {
  if (typeof value !== "string") return null;
  try {
    const crop = JSON.parse(value) as ImageCrop;
    if (
      [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) &&
      crop.width >= 0.1 &&
      crop.height >= 0.1 &&
      crop.x >= 0 &&
      crop.y >= 0 &&
      crop.x + crop.width <= 1 &&
      crop.y + crop.height <= 1
    )
      return crop;
  } catch {
    // Ignore legacy crop values and start with a fresh crop frame.
  }
  return null;
}

const imageResizeHandles: Array<{
  handle: ImageResizeHandle;
  labelKey: string;
  className: string;
  markerClassName: string;
}> = [
  {
    handle: "nw",
    labelKey: "editor.resizeTopLeft",
    className: "-top-3 -left-3 cursor-nwse-resize size-8",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "n",
    labelKey: "editor.resizeTop",
    className: "-top-3 left-1/2 -translate-x-1/2 cursor-ns-resize size-8",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "ne",
    labelKey: "editor.resizeTopRight",
    className: "-top-3 -right-3 cursor-nesw-resize size-8",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "e",
    labelKey: "editor.resizeRight",
    className: "inset-y-0 right-0 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
  {
    handle: "se",
    labelKey: "editor.resize",
    className: "-right-3 -bottom-3 cursor-nwse-resize size-8",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "s",
    labelKey: "editor.resizeBottom",
    className: "-bottom-3 left-1/2 -translate-x-1/2 cursor-ns-resize size-8",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "sw",
    labelKey: "editor.resizeBottomLeft",
    className: "-bottom-3 -left-3 cursor-nesw-resize size-8",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "w",
    labelKey: "editor.resizeLeft",
    className: "inset-y-0 left-0 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
];

/**
 * Trims the float noise out of a value on its way into a style attribute.
 * 100 / 0.3 is 333.33333333333337 in binary floating point, which is both
 * unreadable in the DOM and awkward to assert on.
 */
function roundForCss(value: number) {
  return Number(value.toFixed(4));
}

function ResizableImageComponent({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const [pendingWidth, setPendingWidth] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const { t } = useTranslation();
  const [captionDraft, setCaptionDraft] = useState(
    String(node.attrs.caption ?? ""),
  );
  const [cropOpen, setCropOpen] = useState(false);
  const [cropDraft, setCropDraft] = useState<ImageCrop>(defaultImageCrop);
  const [measuredImageAspectRatio, setMeasuredImageAspectRatio] = useState<
    number | null
  >(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const removeResizeListeners = useRef<() => void>(() => undefined);
  const removeCropListeners = useRef<() => void>(() => undefined);
  const hideToolsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cropPreviewRef = useRef<HTMLDivElement>(null);
  const cropActionRef = useRef<{
    kind: "move" | ImageResizeHandle;
    x: number;
    y: number;
    crop: ImageCrop;
  } | null>(null);
  const savedWidth = normaliseImageWidth(node.attrs.width);
  const displayWidth = pendingWidth ?? savedWidth;
  const canResize = editor.isEditable;
  const alignment = (node.attrs.alignment ?? "left") as ImageAlignment;
  const crop = parseImageCrop(node.attrs.crop);
  // Older documents stored the source image width after cropping.  New crops
  // store the width of the resulting (visible) crop instead.  Keep rendering
  // the older form correctly so those pages do not suddenly produce a huge
  // cropped image.
  const cropWidthFinal = Boolean(node.attrs.cropWidthFinal);
  const savedImageAspectRatio = normaliseImageAspectRatio(
    node.attrs.cropSourceAspectRatio,
  );
  const imageAspectRatio =
    measuredImageAspectRatio ?? savedImageAspectRatio ?? 1;
  const cropUsesFinalWidth = Boolean(crop && (cropWidthFinal || pendingWidth));
  const croppedDisplayWidth =
    crop && displayWidth
      ? cropUsesFinalWidth
        ? displayWidth
        : displayWidth * crop.width
      : undefined;
  // The visible crop's own aspect ratio: the selected fraction of the source,
  // in the source's proportions. Everything about the cropped frame is laid
  // out from this ratio and relative units, so the frame can shrink with its
  // container - a fixed pixel height would keep the frame at its original size
  // and let the page clip whatever no longer fits.
  const croppedAspectRatio = crop
    ? roundForCss((crop.width / crop.height) * imageAspectRatio)
    : undefined;
  const showImageTools =
    canResize && (hovered || resizing || captionOpen || cropOpen);

  const setWidth = useCallback(
    (nextWidth: number) =>
      updateAttributes({
        width: Math.round(nextWidth),
        // A legacy crop stored the source width. Once resized, the saved
        // width becomes the visible crop width so it cannot jump on the next
        // interaction.
        ...(crop
          ? {
              cropWidthFinal: "true",
              cropSourceAspectRatio: String(imageAspectRatio),
            }
          : {}),
      }),
    [crop, imageAspectRatio, updateAttributes],
  );

  useEffect(
    () => () => {
      removeResizeListeners.current();
      removeCropListeners.current();
      if (resizeFrame.current !== null)
        cancelAnimationFrame(resizeFrame.current);
      if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    },
    [],
  );

  function rememberImageAspectRatio(image: HTMLImageElement) {
    const ratio =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : null;
    if (!ratio) return;
    setMeasuredImageAspectRatio((current) =>
      current === null || Math.abs(current - ratio) > 0.0001 ? ratio : current,
    );
  }

  function keepImageToolsVisible() {
    if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    setHovered(true);
  }

  // Hover is tracked on the figure alone. The toolbar sits inside it, so
  // moving between the two never leaves the figure - but a mouseleave on the
  // toolbar itself would fire on the way back to the image and hide the tools
  // the pointer is still over, with no matching mouseenter to bring them back.
  function scheduleImageToolsHide() {
    if (resizing) return;
    if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    hideToolsTimer.current = setTimeout(() => setHovered(false), 180);
  }

  function startResize(
    clientX: number,
    handle: ImageResizeHandle,
    moveEventName: "pointermove" | "mousemove",
    upEventName: "pointerup" | "mouseup",
  ) {
    if (resizeStart.current) return;
    // For cropped images, the <img> is intentionally larger than the visible
    // crop frame. Resize the frame, not that hidden expanded source image.
    const frameBounds = imageFrameRef.current?.getBoundingClientRect();
    const width = frameBounds?.width ?? displayWidth ?? savedWidth ?? 240;
    resizeStart.current = { x: clientX, width };
    pendingWidthRef.current = width;
    setPendingWidth(width);
    setResizing(true);
    const onMove = (moveEvent: Event) => {
      const start = resizeStart.current;
      const frame = imageFrameRef.current;
      if (!start || !frame) return;
      const availableWidth = editorWidthAround(frame);
      const pointer = moveEvent as MouseEvent;
      // The editor deliberately exposes only left/right resize bars. Their
      // size must depend solely on X movement; Y movement belongs to neither
      // resizing nor image scaling.
      const horizontalDelta =
        handle === "w" ? start.x - pointer.clientX : pointer.clientX - start.x;
      const nextWidth = Math.max(
        80,
        Math.min(availableWidth, start.width + horizontalDelta),
      );
      pendingWidthRef.current = nextWidth;
      if (resizeFrame.current !== null) return;
      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = null;
        setPendingWidth(pendingWidthRef.current);
      });
    };
    const onUp = () => {
      const finalWidth = pendingWidthRef.current;
      if (finalWidth !== null) setWidth(finalWidth);
      resizeStart.current = null;
      pendingWidthRef.current = null;
      if (resizeFrame.current !== null) {
        cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = null;
      }
      setPendingWidth(null);
      setResizing(false);
      removeResizeListeners.current();
    };
    removeResizeListeners.current();
    removeResizeListeners.current = () => {
      window.removeEventListener(moveEventName, onMove);
      window.removeEventListener(upEventName, onUp);
    };
    window.addEventListener(moveEventName, onMove);
    window.addEventListener(upEventName, onUp, { once: true });
  }

  function beginResize(
    event: React.PointerEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startResize(event.clientX, handle, "pointermove", "pointerup");
  }

  function beginMouseResize(
    event: React.MouseEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    startResize(event.clientX, handle, "mousemove", "mouseup");
  }

  function beginResizeFromFrameEdge(event: React.PointerEvent<HTMLElement>) {
    if (
      !canResize ||
      (event.target as HTMLElement).closest("button, [role=dialog]")
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edgeSize = IMAGE_RESIZE_EDGE_SIZE;
    const handle =
      event.clientX - bounds.left <= edgeSize
        ? "w"
        : bounds.right - event.clientX <= edgeSize
          ? "e"
          : null;
    if (!handle) return;

    // The transparent hit zones are a visual aid. Capturing directly at the
    // frame level makes the resize reliable even if a cropped image paints
    // over one of those zones.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startResize(event.clientX, handle, "pointermove", "pointerup");
  }

  function resizeWithKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    const frame = imageFrameRef.current!;
    const current = frame.getBoundingClientRect().width;
    const adjustment =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -16
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 16
          : 0;
    if (!adjustment) return;
    event.preventDefault();
    const availableWidth = editorWidthAround(frame);
    const direction = handle.includes("w") || handle.includes("n") ? -1 : 1;
    setWidth(
      Math.max(80, Math.min(availableWidth, current + adjustment * direction)),
    );
  }

  function selectImage() {
    if (!canResize || typeof getPos !== "function") return;
    const position = getPos();
    if (typeof position === "number") {
      editor.commands.setNodeSelection(position);
    }
  }

  function setImageAlignment(nextAlignment: ImageAlignment) {
    updateAttributes({ alignment: nextAlignment });
  }

  function saveCaption() {
    updateAttributes({ caption: captionDraft.trim() || null });
    setCaptionOpen(false);
  }

  function setImageCrop(nextCrop: ImageCrop) {
    // The crop is represented against the original source. Its on-page width
    // must therefore be the selected fraction of the source width, rather
    // than the full source width. Otherwise a narrow crop expands into a tall
    // oversized frame after it is saved.
    const measuredWidth = imageRef.current?.getBoundingClientRect().width ?? 0;
    const sourceWidth =
      crop && displayWidth
        ? cropWidthFinal
          ? displayWidth / crop.width
          : displayWidth
        : (displayWidth ?? measuredWidth);
    const croppedWidth = Math.max(80, Math.round(sourceWidth * nextCrop.width));
    // The crop preview is the exact canvas the user selected against. Its
    // rendered ratio is more reliable than a previously measured image ratio
    // (which may have been affected by a prior crop or attachment preview).
    const previewBounds = cropPreviewRef.current?.getBoundingClientRect();
    const cropCanvasAspectRatio =
      previewBounds && previewBounds.width > 0 && previewBounds.height > 0
        ? previewBounds.width / previewBounds.height
        : imageAspectRatio;
    setMeasuredImageAspectRatio(cropCanvasAspectRatio);
    updateAttributes({
      crop: JSON.stringify(nextCrop),
      width: croppedWidth,
      cropWidthFinal: "true",
      cropSourceAspectRatio: String(cropCanvasAspectRatio),
      // Re-cropping is allowed. Clearing the legacy lock also lets content
      // cropped with an earlier editor version be adjusted again.
      cropFinal: null,
    });
    setCropOpen(false);
  }

  function openCropEditor() {
    setCropDraft(crop ?? defaultImageCrop);
    setCropOpen(true);
  }

  function beginCrop(
    event: React.PointerEvent<HTMLButtonElement | HTMLDivElement>,
    kind: "move" | ImageResizeHandle,
  ) {
    event.preventDefault();
    // Resize handles live inside the movable crop frame. Do not let their
    // pointer-down event bubble to that frame, or it overwrites the resize
    // action with a move action before dragging starts.
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cropActionRef.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      crop: cropDraft,
    };
    removeCropListeners.current();
    const onMove = (moveEvent: PointerEvent) => {
      moveCrop(moveEvent.clientX, moveEvent.clientY);
    };
    const onEnd = () => {
      cropActionRef.current = null;
      removeCropListeners.current();
    };
    removeCropListeners.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }

  function moveCrop(clientX: number, clientY: number) {
    const action = cropActionRef.current;
    const bounds = cropPreviewRef.current?.getBoundingClientRect();
    if (!action || !bounds) return;
    const dx = (clientX - action.x) / bounds.width;
    const dy = (clientY - action.y) / bounds.height;
    const minimum = 0.1;
    let { x, y, width, height } = action.crop;
    if (action.kind === "move") {
      x = Math.max(0, Math.min(1 - width, x + dx));
      y = Math.max(0, Math.min(1 - height, y + dy));
    } else {
      if (action.kind.includes("w")) {
        x = Math.max(
          0,
          Math.min(action.crop.x + action.crop.width - minimum, x + dx),
        );
        width = action.crop.width - (x - action.crop.x);
      }
      if (action.kind.includes("n")) {
        y = Math.max(
          0,
          Math.min(action.crop.y + action.crop.height - minimum, y + dy),
        );
        height = action.crop.height - (y - action.crop.y);
      }
      if (action.kind.includes("e"))
        width = Math.max(minimum, Math.min(1 - x, width + dx));
      if (action.kind.includes("s"))
        height = Math.max(minimum, Math.min(1 - y, height + dy));
    }
    setCropDraft({ x, y, width, height });
  }

  function prepareImageMove(event: React.DragEvent<HTMLDivElement>) {
    if (!canResize || (event.target as HTMLElement).closest("button")) return;
    selectImage();
    const position = typeof getPos === "function" ? getPos() : undefined;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos: position },
      }),
    );
  }

  function finishImageMove(event: React.DragEvent<HTMLDivElement>) {
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        "group/image relative my-4 block w-fit max-w-full align-top",
        showImageTools &&
          "before:bg-border-strong after:bg-border-strong before:pointer-events-none before:absolute before:top-1/3 before:bottom-1/3 before:left-1 before:z-20 before:w-1.5 before:rounded-full after:pointer-events-none after:absolute after:top-1/3 after:right-1 after:bottom-1/3 after:z-20 after:w-1.5 after:rounded-full",
      )}
      contentEditable={false}
      // Read by the wrapper rule in globals.css, which is the element that
      // actually has room to move.
      data-alignment={alignment}
      onClick={selectImage}
      onPointerDownCapture={beginResizeFromFrameEdge}
      onMouseEnter={keepImageToolsVisible}
      onMouseLeave={scheduleImageToolsHide}
      onDragStartCapture={prepareImageMove}
      onDragEndCapture={finishImageMove}
    >
      <div
        ref={imageFrameRef}
        className={cn(crop && "relative overflow-hidden")}
        style={
          crop
            ? {
                // A definite pixel width keeps the frame at the size the crop
                // was saved at, while max-width lets it shrink with a narrower
                // column the way an uncropped image does. Percentages here
                // would be circular - the figure is shrink-to-fit around this
                // very element - and collapse the frame to nothing.
                width: croppedDisplayWidth
                  ? `${croppedDisplayWidth}px`
                  : undefined,
                maxWidth: "100%",
                // The height follows from the ratio, so shrinking keeps both
                // the proportions and the selected region.
                aspectRatio: String(croppedAspectRatio),
              }
            : undefined
        }
      >
        {/* Authenticated attachment URLs cannot be optimized by next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ""}
          title={node.attrs.title ?? undefined}
          draggable={canResize}
          onLoad={(event) => rememberImageAspectRatio(event.currentTarget)}
          className={cn(
            "block max-w-full cursor-grab active:cursor-grabbing",
            crop ? "max-w-none" : "h-auto",
          )}
          style={
            crop
              ? {
                  position: "absolute",
                  // Prose styles give images a vertical margin. On an
                  // absolutely positioned box that margin is added to the
                  // offsets below, sliding the source image down by a fixed
                  // number of pixels while its height scales with the frame -
                  // so the visible slice drifts as the image is resized.
                  margin: 0,
                  // Every dimension is a share of the frame, so the source
                  // rectangle scales with it and the selected region stays
                  // put whatever size the frame ends up.
                  width: `${roundForCss(100 / crop.width)}%`,
                  height: `${roundForCss(100 / crop.height)}%`,
                  maxWidth: "none",
                  left: `${roundForCss((-crop.x / crop.width) * 100)}%`,
                  top: `${roundForCss((-crop.y / crop.height) * 100)}%`,
                }
              : displayWidth
                ? { width: `${displayWidth}px`, maxWidth: "100%" }
                : undefined
          }
        />
      </div>
      {node.attrs.caption ? (
        <figcaption className="text-muted-foreground -mt-0.5 text-center text-xs italic opacity-80">
          {node.attrs.caption}
        </figcaption>
      ) : null}
      {showImageTools ? (
        <>
          {/* Floats above the image so it covers none of it. The wrapper's
              bottom padding is what puts the visible gap there: an actual gap
              would be a strip of neither figure nor toolbar, and crossing it
              would count as leaving the image. */}
          <div className="absolute right-0 bottom-full z-20 pb-1">
            <div
              className="border-border bg-surface-raised/95 flex h-9 items-center gap-0.5 rounded-md border p-1 shadow-md backdrop-blur-sm"
              role="toolbar"
              aria-label={t("editor.imageOptionsAria")}
            >
              {(
                [
                  ["left", AlignLeft, "editor.alignImageLeft"],
                  ["center", AlignCenter, "editor.alignImageCenter"],
                  ["right", AlignRight, "editor.alignImageRight"],
                ] as const
              ).map(([value, Icon, labelKey]) => {
                const label = t(labelKey);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={alignment === value}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setImageAlignment(value)}
                    className={cn(
                      "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      alignment === value && TOGGLE_ON_CLASS,
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </button>
                );
              })}
              <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
              <button
                type="button"
                aria-label={t("editor.addImageCaption")}
                title={t("editor.addImageCaption")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  setCaptionDraft(String(node.attrs.caption ?? ""));
                  setCaptionOpen(true);
                }}
                aria-pressed={Boolean(node.attrs.caption)}
                className={cn(
                  "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  node.attrs.caption && TOGGLE_ON_CLASS,
                )}
              >
                <Type className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t("editor.cropImage")}
                title={t("editor.cropImage")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={openCropEditor}
                className={cn(
                  "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  crop && TOGGLE_ON_CLASS,
                )}
              >
                <Crop className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t("editor.imageDetails")}
                title={t("editor.imageDetails")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  const src = String(node.attrs.src ?? "");
                  const match = src.match(
                    /\/api\/v1\/attachments\/([a-f0-9-]{36})/i,
                  );
                  if (match) {
                    const event = new CustomEvent("wikihub:view-file-details", {
                      detail: match[1],
                    });
                    document.dispatchEvent(event);
                  }
                }}
                className="hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <Info className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <Dialog open={captionOpen} onOpenChange={setCaptionOpen}>
            <DialogContent
              title={t("editor.imageCaption")}
              className="max-w-md"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="image-caption">
                  {t("editor.caption")}
                </label>
                <Input
                  id="image-caption"
                  value={captionDraft}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  placeholder={t("editor.imagePlaceholder")}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCaptionOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="button" variant="primary" onClick={saveCaption}>
                  {t("editor.saveCaption")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={cropOpen} onOpenChange={setCropOpen}>
            <DialogContent
              title="Crop image"
              className="max-w-3xl overflow-hidden p-0 [&>button[aria-label=Close]]:hidden [&>div:first-child]:sr-only"
            >
              <div className="border-border flex h-14 items-center justify-between border-b px-3">
                <span className="w-16" aria-hidden />
                <span className="text-sm font-medium">Crop image</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCropOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setImageCrop(cropDraft)}
                  >
                    Save
                  </Button>
                </div>
              </div>
              <div className="bg-surface-sunken p-6">
                <div
                  ref={cropPreviewRef}
                  className="relative mx-auto w-fit max-w-full touch-none overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={node.attrs.src}
                    alt="Crop preview"
                    className="mx-auto block max-h-[52vh] max-w-full select-none"
                    draggable={false}
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute inset-x-0 top-0"
                    style={{ height: `${cropDraft.y * 100}%` }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute inset-x-0 bottom-0"
                    style={{
                      height: `${(1 - cropDraft.y - cropDraft.height) * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute"
                    style={{
                      left: 0,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.x * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute"
                    style={{
                      right: 0,
                      top: `${cropDraft.y * 100}%`,
                      width: `${(1 - cropDraft.x - cropDraft.width) * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="border-foreground/80 absolute cursor-move border-2"
                    style={{
                      left: `${cropDraft.x * 100}%`,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.width * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    onPointerDown={(event) => beginCrop(event, "move")}
                  >
                    {(
                      [
                        ["nw", "-top-2 -left-2 cursor-nwse-resize"],
                        [
                          "n",
                          "-top-2 left-1/2 -translate-x-1/2 cursor-ns-resize",
                        ],
                        ["ne", "-top-2 -right-2 cursor-nesw-resize"],
                        [
                          "e",
                          "top-1/2 -right-2 -translate-y-1/2 cursor-ew-resize",
                        ],
                        ["se", "-right-2 -bottom-2 cursor-nwse-resize"],
                        [
                          "s",
                          "-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize",
                        ],
                        ["sw", "-bottom-2 -left-2 cursor-nesw-resize"],
                        [
                          "w",
                          "top-1/2 -left-2 -translate-y-1/2 cursor-ew-resize",
                        ],
                      ] as const
                    ).map(([handle, positionClass]) => (
                      <button
                        key={handle}
                        type="button"
                        aria-label={t("editor.resizeCrop", { handle })}
                        onPointerDown={(event) => beginCrop(event, handle)}
                        className={cn(
                          "bg-foreground border-surface focus-visible:ring-ring absolute size-3 rounded-sm border-2 focus-visible:ring-2 focus-visible:outline-none",
                          positionClass,
                        )}
                      />
                    ))}
                    <span className="bg-foreground/70 pointer-events-none absolute top-1/2 -left-1 h-10 w-1 -translate-y-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute top-1/2 -right-1 h-10 w-1 -translate-y-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute -top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute -bottom-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full" />
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <button
            type="button"
            aria-label={t("editor.inactiveResizeAria")}
            title={t("editor.dragToResizeImage")}
            onPointerDown={(event) => beginResize(event, "se")}
            onMouseDown={(event) => beginMouseResize(event, "se")}
            onKeyDown={(event) => resizeWithKeyboard(event, "se")}
            className="hidden"
          >
            <span aria-hidden>↘</span>
          </button>
        </>
      ) : null}
      {canResize
        ? imageResizeHandles
            .filter(({ handle }) => handle === "e" || handle === "w")
            .map(({ handle, labelKey, className }) => (
              <button
                key={handle}
                type="button"
                aria-label={t(labelKey)}
                title={t(labelKey)}
                onPointerDown={(event) => beginResize(event, handle)}
                onMouseDown={(event) => beginMouseResize(event, handle)}
                onKeyDown={(event) => resizeWithKeyboard(event, handle)}
                // Sits under the options toolbar (z-20) so the buttons in it
                // stay clickable on a short image.
                className={cn(
                  "focus-visible:ring-ring absolute z-10 flex touch-none items-center justify-center bg-transparent select-none focus-visible:ring-2 focus-visible:outline-none",
                  className,
                )}
                style={{ width: IMAGE_RESIZE_EDGE_SIZE }}
              />
            ))
        : null}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          normaliseImageWidth(
            element.getAttribute("width") ?? element.style.width,
          ),
        renderHTML: (attributes) =>
          normaliseImageWidth(attributes.width)
            ? { width: String(normaliseImageWidth(attributes.width)) }
            : {},
      },
      alignment: {
        default: "left",
        parseHTML: (element) =>
          element.getAttribute("data-alignment") ?? "left",
        renderHTML: (attributes) =>
          attributes.alignment && attributes.alignment !== "left"
            ? { "data-alignment": attributes.alignment }
            : {},
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      crop: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop"),
        renderHTML: (attributes) =>
          attributes.crop ? { "data-crop": attributes.crop } : {},
      },
      cropFinal: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop-final"),
        renderHTML: (attributes) =>
          attributes.cropFinal ? { "data-crop-final": "true" } : {},
      },
      cropWidthFinal: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop-width-final"),
        renderHTML: (attributes) =>
          attributes.cropWidthFinal ? { "data-crop-width-final": "true" } : {},
      },
      cropSourceAspectRatio: {
        default: null,
        parseHTML: (element) =>
          normaliseImageAspectRatio(
            element.getAttribute("data-crop-source-aspect-ratio"),
          ),
        renderHTML: (attributes) => {
          const ratio = normaliseImageAspectRatio(
            attributes.cropSourceAspectRatio,
          );
          return ratio
            ? { "data-crop-source-aspect-ratio": String(ratio) }
            : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});

"use client";

import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer/browser";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function PptxAttachmentPreview({
  contentUrl,
  filename,
  expanded = false,
  toolbarContainer,
  headerAfterControls,
}: {
  contentUrl: string;
  filename: string;
  expanded?: boolean;
  toolbarContainer?: HTMLElement | null;
  headerAfterControls?: ReactNode;
}) {
  const viewerRef = useRef<PptxViewer | null>(null);
  const engineRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const slideHandlesRef = useRef<SlideHandle[]>([]);
  const mainHandleRef = useRef<SlideHandle | null>(null);
  const activeSlideRef = useRef(0);
  const [slideCount, setSlideCount] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading slides...");
  const [error, setError] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [viewportRevision, setViewportRevision] = useState(0);
  const useHeaderControls = toolbarContainer !== null && toolbarContainer !== undefined;

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    async function loadDeck() {
      setLoading(true);
      setError(null);
      setLoadingMessage("Loading the PowerPoint file...");
      try {
        const {
          PptxViewer: Viewer,
          RECOMMENDED_ZIP_LIMITS,
        } = await import("@aiden0z/pptx-renderer/browser");
        if (!engineRef.current || !mainRef.current || !thumbnailsRef.current || disposed) return;
        const response = await fetch(contentUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load this PowerPoint file.");
        const buffer = await response.arrayBuffer();
        setLoadingMessage("Parsing presentation...");
        // Keep the library's own rendering surface separate from the visible
        // slide canvas. Its ResizeObserver otherwise redraws the initial slide
        // with width-based fitting immediately after Expand and overwrites our
        // height-based external render.
        const viewer = new Viewer(engineRef.current, {
          fitMode: "contain",
          lazyMedia: true,
          // Slides with late layout/media relationships can render as an
          // empty background when parsed lazily. Parse slide content eagerly;
          // thumbnails remain incremental so the UI still becomes usable fast.
          lazySlides: false,
          pdfjs: false,
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        viewerRef.current = viewer;
        // Bootstrap in windowed list mode so the renderer only mounts the
        // first slide before handing control back to the UI. Rendering a
        // single slide through the viewer's slide mode can make large decks
        // wait for the whole render queue before the promise resolves.
        await viewer.open(buffer, {
          renderMode: "list",
          listOptions: {
            windowed: true,
            initialSlides: 1,
            batchSize: 1,
            overscanViewport: 0.5,
          },
          signal: controller.signal,
        });
        if (disposed) return;

        setSlideCount(viewer.slideCount);
        // The viewer has already rendered the first slide in slide mode. Show
        // it immediately; thumbnails are secondary and can be prepared after
        // the useful content is on screen.
        setLoading(false);
        setLoadingMessage(`Creating slide previews (0/${viewer.slideCount})...`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const handles: SlideHandle[] = [];
        for (let index = 0; index < viewer.slideCount; index += 1) {
          const thumbnail = document.createElement("div");
          thumbnail.className = "pptx-thumbnail-canvas";
          thumbnail.dataset.active = index === activeSlideRef.current ? "true" : "false";
          thumbnailsRef.current?.appendChild(thumbnail);
          const handle = viewer.renderThumbnailToContainer(index, thumbnail, { width: 132 });
          thumbnail.addEventListener("click", () => setActiveSlide(index));
          if (handle) handles.push(handle);
          if ((index + 1) % 3 === 0 || index === viewer.slideCount - 1) {
            setLoadingMessage(`Creating slide previews (${index + 1}/${viewer.slideCount})...`);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        }
        slideHandlesRef.current = handles;
      } catch (loadError) {
        if (!disposed && !controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this PowerPoint file.");
          setLoading(false);
        }
      }
    }

    void loadDeck();
    return () => {
      disposed = true;
      controller.abort();
      mainHandleRef.current?.dispose();
      slideHandlesRef.current.forEach((handle) => handle.dispose());
      viewerRef.current?.destroy();
      mainHandleRef.current = null;
      slideHandlesRef.current = [];
      viewerRef.current = null;
    };
  }, [contentUrl]);

  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    const main = mainRef.current;
    const viewport = viewportRef.current;
    if (!viewer || !main || !viewport || !slideCount) return;
    mainHandleRef.current?.dispose();
    main.replaceChildren();
    const availableWidth = Math.max(1, viewport.clientWidth - 32);
    const availableHeight = Math.max(1, viewport.clientHeight - 32);
    const fitScale = expanded
      ? availableHeight / viewer.slideHeight
      : Math.min(
          availableWidth / viewer.slideWidth,
          availableHeight / viewer.slideHeight,
        );
    const scale = fitScale * (zoomPercent / 100);
    const renderedWidth = viewer.slideWidth * scale;
    const renderedHeight = viewer.slideHeight * scale;
    // The renderer applies `scale()` to the slide element, but transformed
    // elements keep their unscaled layout size. Give the scaled slide a
    // matching layout shell; otherwise flex centering treats it as much
    // wider than it looks and the left side gets clipped.
    const contentWidth = Math.max(availableWidth, renderedWidth);
    const contentHeight = Math.max(availableHeight, renderedHeight);
    main.style.display = "block";
    main.style.position = "relative";
    main.style.width = `${contentWidth}px`;
    main.style.height = `${contentHeight}px`;
    main.style.flex = "0 0 auto";
    const slideShell = document.createElement("div");
    slideShell.style.width = `${renderedWidth}px`;
    slideShell.style.height = `${renderedHeight}px`;
    slideShell.style.position = "absolute";
    slideShell.style.left = `${Math.max(0, (contentWidth - renderedWidth) / 2)}px`;
    slideShell.style.top = `${Math.max(0, (contentHeight - renderedHeight) / 2)}px`;
    slideShell.style.overflow = "hidden";
    slideShell.style.margin = "0";
    main.appendChild(slideShell);
    mainHandleRef.current = viewer.renderSlideToContainer(activeSlide, slideShell, scale);
    thumbnailsRef.current?.querySelectorAll<HTMLElement>(".pptx-thumbnail-canvas").forEach((thumbnail, index) => {
      thumbnail.dataset.active = index === activeSlide ? "true" : "false";
    });
    thumbnailsRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
    activeSlideRef.current = activeSlide;
  }, [activeSlide, expanded, slideCount, viewportRevision, zoomPercent]);

  useLayoutEffect(() => {
    if (!expanded) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      setZoomPercent(100);
      setViewportRevision((revision) => revision + 1);
      secondFrame = requestAnimationFrame(() => {
        setViewportRevision((revision) => revision + 1);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [expanded]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportRevision((revision) => revision + 1));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setActiveSlide((current) => {
        const next = event.key === "ArrowRight" ? current + 1 : current - 1;
        return Math.max(0, Math.min(slideCount - 1, next));
      });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slideCount]);

  if (error) return <div className="text-danger flex min-h-80 items-center justify-center p-4 text-sm">{error}</div>;
  const zoomControls = (
    <>
      <button
        type="button"
        onClick={() => setZoomPercent((zoom) => Math.max(50, zoom - 25))}
        disabled={zoomPercent <= 50}
        aria-label="Zoom out"
        title="Zoom out"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <ZoomOut className="size-4" />
      </button>
      <span className="min-w-12 text-center text-xs tabular-nums">{zoomPercent}%</span>
      <button
        type="button"
        onClick={() => setZoomPercent((zoom) => Math.min(300, zoom + 25))}
        disabled={zoomPercent >= 300}
        aria-label="Zoom in"
        title="Zoom in"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <ZoomIn className="size-4" />
      </button>
    </>
  );
  return (
    <div className="relative h-full min-h-80 min-w-0" aria-busy={loading}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[2000px] top-0 h-[540px] w-[960px] overflow-hidden opacity-0"
      >
        <div ref={engineRef} className="h-full w-full" />
      </div>
      <div className="pptx-attachment-preview flex h-full min-h-80 min-w-0 flex-col gap-2 overflow-hidden">
        {useHeaderControls && toolbarContainer
          ? createPortal(<>{zoomControls}{headerAfterControls}</>, toolbarContainer)
          : (
              <div className="pptx-toolbar bg-surface-sunken text-muted-foreground flex h-9 shrink-0 items-center justify-end gap-1 border-b px-2">
                {zoomControls}
              </div>
            )}
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <aside ref={thumbnailsRef} className="pptx-thumbnails bg-surface-sunken flex w-40 shrink-0 flex-col gap-2 overflow-y-auto rounded-md border p-1.5" aria-label="PowerPoint slides" />
        <section ref={viewportRef} className="bg-surface-sunken relative flex min-w-0 flex-1 items-start justify-start overflow-auto rounded-md border p-3" aria-label={`Slide ${activeSlide + 1} of ${slideCount}`}>
        <div ref={mainRef} className="pptx-main-slide flex min-h-full items-start justify-center" />
        <button type="button" onClick={() => setActiveSlide((current) => Math.max(0, current - 1))} disabled={activeSlide === 0} aria-label="Previous slide" className="bg-surface-raised text-foreground hover:bg-surface-hover focus-visible:ring-ring absolute top-1/2 left-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => setActiveSlide((current) => Math.min(slideCount - 1, current + 1))} disabled={activeSlide === slideCount - 1} aria-label="Next slide" className="bg-surface-raised text-foreground hover:bg-surface-hover focus-visible:ring-ring absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronRight className="size-4" />
        </button>
        <span className="bg-surface-raised text-muted-foreground absolute right-3 bottom-3 rounded px-2 py-1 text-xs shadow-sm">{activeSlide + 1} / {slideCount}</span>
        </section>
        </div>
      </div>
      {loading ? (
        <div className="bg-surface/95 text-muted-foreground absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm">
          <Loader2 className="size-5 animate-spin" />
          <span>{loadingMessage}</span>
          <span className="text-xs">Large presentations may take a little longer.</span>
        </div>
      ) : null}
      <span className="sr-only">Previewing {filename}</span>
    </div>
  );
}

"use client";

import { Download, Expand, FileText, Loader2, RotateCw, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "@/lib/i18n/context";

type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfPage = {
  getViewport: (options: { scale: number; rotation: number }) => PdfViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTask;
};
type PdfDocument = { numPages: number; getPage: (pageNumber: number) => Promise<PdfPage>; destroy?: () => Promise<void> | void };

function PdfPageCanvas({ document: pdfDocument, pageNumber, scale, rotation }: { document: PdfDocument; pageNumber: number; scale: number; rotation: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: PdfRenderTask | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      try {
        setRenderError(null);
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        const ratio = window.devicePixelRatio || 1;
        const renderViewport = page.getViewport({ scale: scale * ratio, rotation });
        const buffer = window.document.createElement("canvas");
        buffer.width = Math.max(1, Math.floor(renderViewport.width));
        buffer.height = Math.max(1, Math.floor(renderViewport.height));
        const bufferContext = buffer.getContext("2d");
        const context = canvas.getContext("2d");
        if (!bufferContext || !context) return;
        task = page.render({ canvasContext: bufferContext, viewport: renderViewport });
        await task.promise;
        if (cancelled || canvasRef.current !== canvas) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.drawImage(buffer, 0, 0);
      } catch (error) {
        if (!cancelled) setRenderError(error instanceof Error ? error.message : "Could not render this page.");
      }
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pageNumber, pdfDocument, rotation, scale]);
  return <div className="bg-surface-raised border-border relative shrink-0 overflow-hidden border shadow-sm"><canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />{renderError ? <div className="text-danger bg-surface-raised absolute inset-0 flex items-center justify-center p-4 text-center text-sm">{renderError}</div> : null}</div>;
}

export function PdfAttachmentPreview({ contentUrl, filename, expanded, onExpandedChange, toolbarContainer }: { contentUrl: string; filename: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; toolbarContainer?: HTMLElement | null }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isExpanded = expanded ?? internalExpanded;
  const useHeaderControls = toolbarContainer !== null && toolbarContainer !== undefined;
  const setExpanded = (value: boolean) => onExpandedChange ? onExpandedChange(value) : setInternalExpanded(value);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PdfDocument | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setLoading(true); setError(null); setPdf(null); setScale(1); setRotation(0);
        const [{ GlobalWorkerOptions, getDocument }, response] = await Promise.all([import("pdfjs-dist"), fetch(contentUrl, { signal: controller.signal })]);
        if (!response.ok) throw new Error("Could not load this PDF file.");
        GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
        loadedPdf = (await getDocument({ data: await response.arrayBuffer() }).promise) as unknown as PdfDocument;
        if (cancelled) { await loadedPdf.destroy?.(); return; }
        setPdf(loadedPdf);
      } catch (loadError) {
        if (!cancelled && !controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load this PDF file.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); void loadedPdf?.destroy?.(); };
  }, [contentUrl]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!pdf || !viewport) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void pdf.getPage(1).then((page) => {
        if (cancelled) return;
        const pageWidth = page.getViewport({ scale: 1, rotation: 0 }).width;
        const targetWidth = Math.max(1, (viewport.clientWidth - 32) * 0.85);
        const fittedScale = Math.min(
          1,
          Math.max(0.1, Math.round((targetWidth / pageWidth) * 10) / 10),
        );
        setScale(fittedScale);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isExpanded, pdf]);

  const controls: ReactNode = <>
    <button type="button" onClick={() => setScale(value => Math.max(.1, Number((value - .1).toFixed(1))))} disabled={scale <= .1} aria-label={t("previews.zoomOut")} title={t("previews.zoomOut")} className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"><ZoomOut className="size-4" /></button>
    <button type="button" onClick={() => setScale(1)} aria-label={t("previews.actualSize")} title={t("previews.actualSizeTitle")} className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring min-w-12 rounded px-1 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none">{Math.round(scale * 100)}%</button>
    <button type="button" onClick={() => setScale(value => Math.min(4, Number((value + .1).toFixed(1))))} disabled={scale >= 4} aria-label={t("previews.zoomIn")} title={t("previews.zoomIn")} className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"><ZoomIn className="size-4" /></button>
    <button type="button" onClick={() => setRotation(value => (value + 90) % 360)} aria-label={t("previews.rotatePages")} title={t("previews.rotatePages")} className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"><RotateCw className="size-4" /></button>
    <button type="button" onClick={() => setExpanded(!isExpanded)} aria-expanded={isExpanded} aria-label={isExpanded ? t("previews.shrinkPreview") : t("previews.expandPreview")} title={isExpanded ? t("previews.shrinkPreview") : t("previews.expandPreview")} className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none">{isExpanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}</button>
  </>;

  return <div className={`fv-root pdf-preview-card relative flex w-full flex-col overflow-hidden ${isExpanded ? "h-full" : "h-[24rem] min-h-80"}`} data-expanded={isExpanded ? "true" : "false"}>
    {useHeaderControls && toolbarContainer ? createPortal(controls, toolbarContainer) : <div className="pdf-preview-toolbar bg-surface-sunken text-muted-foreground flex h-9 shrink-0 items-center justify-end gap-1 border-b px-2">{controls}</div>}
    <div ref={viewportRef} className="bg-surface-sunken min-h-0 flex-1 overflow-auto p-4">
      {loading ? <div className="text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center gap-2 text-sm"><Loader2 className="size-5 animate-spin" /><span>{t("previews.pdfLoading")}</span></div> : null}
      {error ? <div className="text-danger flex h-full min-h-48 flex-col items-center justify-center gap-3 text-sm"><FileText className="size-10" /><span>{error}</span><a href={contentUrl} download={filename} className="text-primary hover:text-primary-hover focus-visible:ring-ring rounded px-2 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"><Download className="mr-1 inline size-4" />{t("previews.downloadPdf")}</a></div> : null}
      {pdf ? <div className="flex min-h-full flex-col items-center gap-4">{Array.from({ length: pdf.numPages }, (_, index) => <PdfPageCanvas key={index + 1} document={pdf} pageNumber={index + 1} scale={scale} rotation={rotation} />)}</div> : null}
    </div>
  </div>;
}

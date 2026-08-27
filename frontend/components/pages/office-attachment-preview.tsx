"use client";

import {
  createBasePreviewRegistry,
  createPreviewPluginRegistry,
  detectFileType,
  enUS,
  LocaleProvider,
  PluginPreviewRenderer,
} from "@lamberl-lee/file-preview";
import { docxPlugin } from "@lamberl-lee/file-preview/plugins/docx";
import { pptxPlugin } from "@lamberl-lee/file-preview/plugins/pptx";
import { xlsxPlugin } from "@lamberl-lee/file-preview/plugins/xlsx";
import { Download, Expand, FileText, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const officePreviewRegistry = createPreviewPluginRegistry([
  ...createBasePreviewRegistry().list(),
  docxPlugin,
  pptxPlugin,
  xlsxPlugin,
]);
const PptxAttachmentPreview = dynamic(
  () =>
    import("@/components/pages/pptx-attachment-preview").then(
      (module) => module.PptxAttachmentPreview,
    ),
  { ssr: false },
);

export function OfficeAttachmentPreview({
  contentUrl,
  filename,
  contentType,
  expanded = false,
  onExpandedChange,
  toolbarContainer,
}: {
  contentUrl: string;
  filename: string;
  contentType: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  toolbarContainer?: HTMLElement | null;
}) {
  const { resolvedTheme } = useTheme();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [docxZoom, setDocxZoom] = useState(100);
  const [isDocxFitWidth, setIsDocxFitWidth] = useState(false);
  const docxPreviewHostRef = useRef<HTMLDivElement>(null);
  const file = useMemo(
    () => ({
      id: contentUrl,
      name: filename,
      size: 0,
      type: contentType,
      fileType: detectFileType(filename, contentType),
      source: {
        kind: "url" as const,
        url: contentUrl,
        name: filename,
        mimeType: contentType,
      },
    }),
    [contentType, contentUrl, filename],
  );

  const isPptx = file.fileType === "pptx" || /\.pptx$/i.test(filename);
  const isDocx = file.fileType === "docx" || /\.docx$/i.test(filename);
  const useHeaderControls = isDocx && toolbarContainer !== null && toolbarContainer !== undefined;

  useLayoutEffect(() => {
    if (!isDocx) return;
    const host = docxPreviewHostRef.current;
    if (!host) return;

    let frame = 0;
    let secondFrame = 0;
    let fitted = false;
    setDocxZoom(100);
    setIsDocxFitWidth(false);

    const fitToPreviewWidth = () => {
      const page = host.querySelector<HTMLElement>(
        ".docx-wrapper > section.docx",
      );
      if (!page || host.clientWidth === 0) return false;
      const pageWidth = page.getBoundingClientRect().width;
      const targetWidth = Math.max(1, (host.clientWidth - 32) * 0.85);
      if (pageWidth === 0) return false;

      // Start the page at roughly 85% of the card width. Keeping
      // the value on 10% increments makes the displayed zoom predictable.
      const fittedZoom = Math.min(
        100,
        Math.max(
          10,
          Math.round(((targetWidth / pageWidth) * 100) / 10) * 10,
        ),
      );
      setDocxZoom(fittedZoom);
      setIsDocxFitWidth(true);
      return true;
    };

    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (fitted || !fitToPreviewWidth()) return;
          fitted = true;
          observer.disconnect();
        });
      });
    };

    const observer = new MutationObserver(scheduleFit);
    observer.observe(host, { childList: true, subtree: true });
    scheduleFit();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      observer.disconnect();
    };
  }, [contentUrl, expanded, isDocx]);

  if (isPptx) {
    const pptxHeaderExpand = toolbarContainer ? (
      <button
        type="button"
        onClick={() => onExpandedChange?.(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? "Shrink preview" : "Expand preview"}
        title={expanded ? "Shrink preview" : "Expand preview"}
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {expanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}
      </button>
    ) : undefined;
    return (
      <div className="fv-root office-preview-card office-preview-card--pptx relative h-[22rem] min-h-64 w-full" data-expanded={expanded ? "true" : "false"} data-fv-theme={resolvedTheme === "dark" ? "dark" : "light"}>
        {!toolbarContainer ? <button
          type="button"
          onClick={() => onExpandedChange?.(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "Shrink preview" : "Expand preview"}
          title={expanded ? "Shrink preview" : "Expand preview"}
          className="fv-btn fv-btn--icon office-expand-button focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}
        </button> : null}
        <PptxAttachmentPreview contentUrl={contentUrl} filename={filename} expanded={expanded} toolbarContainer={toolbarContainer} headerAfterControls={pptxHeaderExpand} />
      </div>
    );
  }

  const docxZoomControls = (
    <>
      <button
        type="button"
        onClick={() => {
          setIsDocxFitWidth(false);
          setDocxZoom((zoom) => Math.max(10, zoom - 10));
        }}
        disabled={docxZoom <= 10}
        aria-label="Zoom out"
        title="Zoom out"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          setIsDocxFitWidth(false);
          setDocxZoom(100);
        }}
        aria-label="Reset zoom"
        title="Actual size (100%)"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring min-w-12 rounded px-1 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {docxZoom}%
      </button>
      <button
        type="button"
        onClick={() => {
          setIsDocxFitWidth(false);
          setDocxZoom((zoom) => Math.min(200, zoom + 10));
        }}
        disabled={docxZoom >= 200}
        aria-label="Zoom in"
        title="Zoom in"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <ZoomIn className="size-4" />
      </button>
    </>
  );

  const expandButton = (
    <button
      type="button"
      onClick={() => onExpandedChange?.(!expanded)}
      aria-expanded={expanded}
      aria-label={expanded ? "Shrink preview" : "Expand preview"}
      title={expanded ? "Shrink preview" : "Expand preview"}
      className={useHeaderControls
        ? "hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
        : "fv-btn fv-btn--icon office-expand-button focus-visible:ring-ring focus-visible:outline-none"}
    >
      {expanded ? <Shrink className="size-4" /> : <Expand className="size-4" />}
    </button>
  );

  return (
    <div className={`fv-root office-preview-card relative h-[22rem] min-h-64 w-full${isDocx ? " office-preview-card--docx" : ""}`} data-expanded={expanded ? "true" : "false"} data-fv-theme={resolvedTheme === "dark" ? "dark" : "light"}>
      {!useHeaderControls ? expandButton : null}
      {isDocx ? (
        useHeaderControls
          ? createPortal(<>{docxZoomControls}{expandButton}</>, toolbarContainer)
          : (
              <div className="office-docx-toolbar bg-surface-sunken text-muted-foreground flex h-9 shrink-0 items-center justify-end gap-1 border-b px-2">
                {docxZoomControls}
              </div>
            )
      ) : null}
        <div
          ref={isDocx ? docxPreviewHostRef : undefined}
          className={`office-preview-content${isDocx ? " office-docx-preview-host" : ""}`}
          data-fit-width={isDocxFitWidth ? "true" : undefined}
        >
        <div className={isDocx ? "office-docx-scale" : undefined} style={isDocx ? { zoom: docxZoom / 100 } : undefined}>
          <LocaleProvider value={enUS}>
            <PluginPreviewRenderer
              file={file}
              registry={officePreviewRegistry}
              largeFilePolicy="off"
              onError={(error) => setPreviewError(error.message)}
            />
          </LocaleProvider>
        </div>
      </div>
      {previewError ? (
        <div className="border-border bg-surface-sunken mt-3 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div className="text-muted-foreground flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0" />
            <span>{previewError}</span>
          </div>
          <a
            href={contentUrl}
            download={filename}
            className="text-primary hover:text-primary-hover focus-visible:ring-ring inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Download className="size-4" />
            Download
          </a>
        </div>
      ) : null}
    </div>
  );
}

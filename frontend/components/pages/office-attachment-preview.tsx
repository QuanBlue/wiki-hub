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
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { prepareWorkbookForPreview } from "@/lib/xlsx-preview-workbook";

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

function spreadsheetColumnLabel(index: number) {
  let label = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

type XlsxEmptyGrid = {
  labels: string[];
  columnHeaders: Array<{ left: number; width: number; label: string }>;
  left: number;
  width: number;
  headerTop: number;
  headerHeight: number;
  rows: Array<{ top: number; height: number }>;
  rowHeaderLeft: number;
  rowHeaderWidth: number;
  rowHeaders: Array<{ top: number; height: number; label: string }>;
};

function sameXlsxEmptyGrid(
  previous: XlsxEmptyGrid | null,
  next: XlsxEmptyGrid | null,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const nearlyEqual = (left: number, right: number) =>
    Math.abs(left - right) < 0.1;
  if (
    previous.labels.length !== next.labels.length ||
    previous.columnHeaders.length !== next.columnHeaders.length ||
    previous.rows.length !== next.rows.length ||
    !nearlyEqual(previous.left, next.left) ||
    !nearlyEqual(previous.width, next.width) ||
    !nearlyEqual(previous.headerTop, next.headerTop) ||
    !nearlyEqual(previous.headerHeight, next.headerHeight) ||
    !nearlyEqual(previous.rowHeaderLeft, next.rowHeaderLeft) ||
    !nearlyEqual(previous.rowHeaderWidth, next.rowHeaderWidth) ||
    previous.rowHeaders.length !== next.rowHeaders.length
  ) {
    return false;
  }
  return previous.columnHeaders.every(
    (column, index) =>
      nearlyEqual(column.left, next.columnHeaders[index].left) &&
      nearlyEqual(column.width, next.columnHeaders[index].width) &&
      column.label === next.columnHeaders[index].label,
  ) && previous.rows.every(
    (row, index) =>
      nearlyEqual(row.top, next.rows[index].top) &&
      nearlyEqual(row.height, next.rows[index].height),
  ) && previous.rowHeaders.every(
    (row, index) =>
      nearlyEqual(row.top, next.rowHeaders[index].top) &&
      nearlyEqual(row.height, next.rowHeaders[index].height) &&
      row.label === next.rowHeaders[index].label,
  );
}

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
  const [xlsxZoom, setXlsxZoom] = useState(100);
  const [xlsxInfo, setXlsxInfo] = useState("");
  const [xlsxEmptyGrid, setXlsxEmptyGrid] = useState<XlsxEmptyGrid | null>(null);
  const docxPreviewHostRef = useRef<HTMLDivElement>(null);
  const xlsxPreviewHostRef = useRef<HTMLDivElement>(null);
  const xlsxColumnHeadersRef = useRef<HTMLDivElement>(null);
  const xlsxEmptyGridRef = useRef<HTMLDivElement>(null);
  const xlsxRowHeadersRef = useRef<HTMLDivElement>(null);
  const fileType = useMemo(
    () => detectFileType(filename, contentType),
    [contentType, filename],
  );

  const isPptx = fileType === "pptx" || /\.pptx$/i.test(filename);
  const isDocx = fileType === "docx" || /\.docx$/i.test(filename);
  const isXlsx = fileType === "xlsx" || /\.xlsx$/i.test(filename);

  // Workbooks are previewed from a corrected copy: see lib/xlsx-preview-workbook
  // for what the renderer gets wrong about a raw file and why.
  // Keyed by the attachment it was built from, so switching attachments reads
  // as "not resolved yet" without an extra state write on every render pass.
  const [xlsxSource, setXlsxSource] = useState<{ key: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    if (!isXlsx) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(contentUrl);
        if (!response.ok) throw new Error(`Attachment request failed: ${response.status}`);
        const workbook = await prepareWorkbookForPreview(await response.arrayBuffer());
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([workbook], { type: contentType }));
        setXlsxSource({ key: contentUrl, url: objectUrl });
      } catch {
        // Trimming is a correction, not a requirement. If the workbook cannot
        // be read here, let the renderer fetch it itself rather than losing
        // the preview entirely.
        if (!cancelled) setXlsxSource({ key: contentUrl, url: contentUrl });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentType, contentUrl, isXlsx]);

  const previewUrl = isXlsx
    ? xlsxSource?.key === contentUrl
      ? xlsxSource.url
      : null
    : contentUrl;
  const file = useMemo(
    () => ({
      id: previewUrl ?? contentUrl,
      name: filename,
      size: 0,
      type: contentType,
      fileType,
      source: {
        kind: "url" as const,
        url: previewUrl ?? contentUrl,
        name: filename,
        mimeType: contentType,
      },
    }),
    [contentType, contentUrl, fileType, filename, previewUrl],
  );
  const useHeaderControls =
    (isDocx || isXlsx) &&
    toolbarContainer !== null &&
    toolbarContainer !== undefined;

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

  useLayoutEffect(() => {
    if (!isXlsx) return;
    const host = xlsxPreviewHostRef.current;
    if (!host) return;
    let frame = 0;
    let settled = false;
    const fitSheetToPreview = () => {
      const content = host.querySelector<HTMLElement>(".fv-xlsx__content");
      const table = host.querySelector<HTMLElement>(".fv-xlsx__table");
      const label = host.querySelector<HTMLElement>(".fv-xlsx__zoom-label");
      const buttons = host.querySelectorAll<HTMLButtonElement>(".fv-xlsx__zoom-btn");
      const currentZoom = Number.parseInt(label?.textContent ?? "", 10);
      if (!content || !table || buttons.length < 2 || !Number.isFinite(currentZoom)) return;
      const tableWidth = table.getBoundingClientRect().width;
      const availableWidth = Math.max(1, content.clientWidth - 16);
      if (tableWidth === 0) return;
      // Do not round up: a larger value would leave a horizontal sliver of the
      // workbook outside the viewport. The package's zoom buttons work in 10%
      // increments, so floor to the nearest supported value instead.
      const targetZoom = Math.min(
        100,
        Math.max(50, Math.floor(((availableWidth / tableWidth) * currentZoom) / 10) * 10),
      );
      const steps = Math.round(Math.abs(targetZoom - currentZoom) / 10);
      const button = targetZoom > currentZoom ? buttons[1] : buttons[0];
      for (let index = 0; index < steps; index += 1) button.click();
      settled = true;
      observer.disconnect();
    };
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!settled) fitSheetToPreview();
      });
    };
    const observer = new MutationObserver(scheduleFit);
    observer.observe(host, { childList: true, subtree: true });
    scheduleFit();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentUrl, expanded, isXlsx]);

  useLayoutEffect(() => {
    if (!isXlsx) return;
    const host = xlsxPreviewHostRef.current;
    if (!host) return;

    const syncToolbarState = () => {
      const label = host.querySelector<HTMLElement>(".fv-xlsx__zoom-label");
      const info = host.querySelector<HTMLElement>(".fv-xlsx__info");
      const zoom = Number.parseInt(label?.textContent ?? "", 10);
      if (Number.isFinite(zoom)) setXlsxZoom(zoom);
      setXlsxInfo(info?.textContent?.trim() ?? "");
    };

    const mutations = new MutationObserver(syncToolbarState);
    mutations.observe(host, { childList: true, characterData: true, subtree: true });
    syncToolbarState();
    return () => mutations.disconnect();
  }, [contentUrl, isXlsx]);

  useLayoutEffect(() => {
    if (!isXlsx) return;
    const host = xlsxPreviewHostRef.current;
    if (!host) return;

    let frame = 0;
    let sheet: HTMLElement | null = null;
    let content: HTMLElement | null = null;
    let scrollTarget: HTMLElement | null = null;
    let scrollOrigin = { left: 0, top: 0 };
    const syncOverlayToScroll = () => {
      if (!content) return;
      const horizontalOffset = scrollOrigin.left - content.scrollLeft;
      const verticalOffset = scrollOrigin.top - content.scrollTop;

      // The generated cells live above the package canvas. Move them on the
      // compositor with the sheet rather than measuring and re-rendering the
      // React tree on every native scroll event. The header is sticky vertically
      // just like the package's own column header, while the blank row grid
      // moves in both directions with the body cells.
      xlsxColumnHeadersRef.current?.style.setProperty(
        "transform",
        `translate3d(${horizontalOffset}px, 0, 0)`,
      );
      xlsxEmptyGridRef.current?.style.setProperty(
        "transform",
        `translate3d(${horizontalOffset}px, ${verticalOffset}px, 0)`,
      );
      xlsxRowHeadersRef.current?.style.setProperty(
        "transform",
        `translate3d(0, ${verticalOffset}px, 0)`,
      );
    };
    const syncViewportWidth = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const card = host.closest<HTMLElement>(".office-preview-card--xlsx");
        sheet = host.querySelector<HTMLElement>(".fv-xlsx");
        content = host.querySelector<HTMLElement>(".fv-xlsx__content");
        const table = host.querySelector<HTMLElement>(".fv-xlsx__table");
        if (!card || !sheet || !content || !table) return;

        const width = Math.floor(card.getBoundingClientRect().width);
        if (width <= 0) return;

        // XlsxPreview is rendered through package-owned intermediary wrappers.
        // Give its viewport the measured card width so its scroll rail always
        // terminates at the Preview card's right edge, independent of the
        // workbook's intrinsic table width.
        const viewportWidth = `${width}px`;
        if (sheet.style.width !== viewportWidth) {
          sheet.style.width = viewportWidth;
        }
        if (sheet.style.maxWidth !== viewportWidth) {
          sheet.style.maxWidth = viewportWidth;
        }

        const headerCount = table.querySelectorAll("thead .fv-xlsx__col-header").length;
        const cardRect = card.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const tableRight = table.getBoundingClientRect().right;
        // clientWidth ends before the native scrollbar. Keeping the generated
        // empty cells inside that edge prevents their row borders from being
        // painted beneath the scroll rail.
        const scrollViewportRight = contentRect.left + content.clientWidth;
        const emptyWidth = Math.max(0, scrollViewportRight - tableRight);
        const columnWidth = Math.max(1, xlsxZoom);
        const headerCells = Array.from(
          table.querySelectorAll<HTMLElement>("thead .fv-xlsx__col-header"),
        ).map((cell) => {
          const cellRect = cell.getBoundingClientRect();
          return {
            label: cell.textContent?.trim() ?? "",
            left: cellRect.left - cardRect.left,
            width: cellRect.width,
          };
        });
        // Individual header cells are sticky while <thead> itself scrolls out
        // of view. Use the first sticky cell as the source of truth so the
        // overlay remains exactly above the header after vertical scrolling.
        const stickyHeaderRect = table
          .querySelector<HTMLElement>("thead .fv-xlsx__col-header")
          ?.getBoundingClientRect();
        const extraHeaderCount =
          emptyWidth > 1 ? Math.ceil(emptyWidth / columnWidth) + 1 : 0;
        const extraColumnHeaders = Array.from(
          { length: extraHeaderCount },
          (_, index) => ({
            label: spreadsheetColumnLabel(Math.max(1, headerCount) + index),
            left: Math.max(0, tableRight - cardRect.left) + index * columnWidth,
            width: columnWidth,
          }),
        );
        const rows = Array.from(table.querySelectorAll("tbody > tr"))
          .map((row) => {
            const rowRect = row.getBoundingClientRect();
            return {
              top: rowRect.top - cardRect.top,
              height: rowRect.height,
            };
          })
          .filter((row) => row.height > 0);
        const rowHeaderCells = Array.from(
          table.querySelectorAll<HTMLElement>("tbody .fv-xlsx__row-num"),
        );
        const firstRowHeaderRect = rowHeaderCells[0]?.getBoundingClientRect();
        const rowHeaders = rowHeaderCells
          .map((cell) => {
            const cellRect = cell.getBoundingClientRect();
            return {
              top: cellRect.top - cardRect.top,
              height: cellRect.height,
              label: cell.textContent?.trim() ?? "",
            };
          })
          .filter((row) => row.height > 0);
        const nextEmptyGrid: XlsxEmptyGrid | null =
          headerCells.length > 0 && firstRowHeaderRect
            ? {
                labels: Array.from(
                  { length: extraHeaderCount },
                  (_, index) => spreadsheetColumnLabel(Math.max(1, headerCount) + index),
                ),
                columnHeaders: [...headerCells, ...extraColumnHeaders],
                left: Math.max(0, tableRight - cardRect.left),
                width: emptyWidth,
                headerTop: Math.max(
                  0,
                  (stickyHeaderRect?.top ?? contentRect.top) - cardRect.top,
                ),
                headerHeight: Math.max(1, stickyHeaderRect?.height ?? 0),
                rows,
                rowHeaderLeft: Math.max(0, firstRowHeaderRect.left - cardRect.left),
                rowHeaderWidth: firstRowHeaderRect.width,
                rowHeaders,
              }
            : null;
        setXlsxEmptyGrid((previous) =>
          sameXlsxEmptyGrid(previous, nextEmptyGrid) ? previous : nextEmptyGrid,
        );
        scrollOrigin = { left: content.scrollLeft, top: content.scrollTop };
        syncOverlayToScroll();

        if (scrollTarget !== content) {
          scrollTarget?.removeEventListener("scroll", syncOverlayToScroll);
          scrollTarget = content;
          scrollTarget.addEventListener("scroll", syncOverlayToScroll, { passive: true });
        }
      });
    };

    const mutations = new MutationObserver(syncViewportWidth);
    mutations.observe(host, { childList: true, subtree: true });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncViewportWidth);
    resize?.observe(host);
    const card = host.closest<HTMLElement>(".office-preview-card--xlsx");
    if (card) resize?.observe(card);
    window.addEventListener("resize", syncViewportWidth);
    syncViewportWidth();

    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", syncViewportWidth);
      scrollTarget?.removeEventListener("scroll", syncOverlayToScroll);
      sheet?.style.removeProperty("width");
      sheet?.style.removeProperty("max-width");
    };
  }, [contentUrl, expanded, isXlsx, xlsxZoom]);

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

  const changeXlsxZoom = (direction: -1 | 1) => {
    const host = xlsxPreviewHostRef.current;
    const buttons = host?.querySelectorAll<HTMLButtonElement>(".fv-xlsx__zoom-btn");
    buttons?.[direction > 0 ? 1 : 0]?.click();
  };

  const xlsxZoomControls = (
    <>
      {xlsxInfo ? <span className="text-muted-foreground mr-2 text-xs font-normal normal-case">{xlsxInfo}</span> : null}
      <button
        type="button"
        onClick={() => changeXlsxZoom(-1)}
        disabled={xlsxZoom <= 50}
        aria-label="Zoom out"
        title="Zoom out"
        className="hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <ZoomOut className="size-4" />
      </button>
      <span className="text-muted-foreground min-w-12 px-1 text-center text-xs font-normal tabular-nums normal-case">{xlsxZoom}%</span>
      <button
        type="button"
        onClick={() => changeXlsxZoom(1)}
        disabled={xlsxZoom >= 200}
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

  const xlsxCanvasStyle = isXlsx
    ? ({
        "--office-xlsx-empty-column-width": `${xlsxZoom}px`,
        "--office-xlsx-empty-row-height": `${Math.max(10, Math.round((22 * xlsxZoom) / 100))}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div className={`fv-root office-preview-card relative h-[22rem] min-h-64 w-full${isDocx ? " office-preview-card--docx" : ""}${isXlsx ? " office-preview-card--xlsx" : ""}`} data-expanded={expanded ? "true" : "false"} data-fv-theme={resolvedTheme === "dark" ? "dark" : "light"}>
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
      {isXlsx && useHeaderControls
        ? createPortal(<>{xlsxZoomControls}{expandButton}</>, toolbarContainer)
        : null}
        <div
          ref={isDocx ? docxPreviewHostRef : isXlsx ? xlsxPreviewHostRef : undefined}
          className={`office-preview-content${isDocx ? " office-docx-preview-host" : ""}`}
          data-fit-width={isDocxFitWidth ? "true" : undefined}
          style={xlsxCanvasStyle}
        >
        <div
          className={isDocx ? "office-docx-scale" : isXlsx ? "office-xlsx-renderer-host" : undefined}
          style={isDocx ? { zoom: docxZoom / 100 } : undefined}
        >
          <LocaleProvider value={enUS}>
            {previewUrl ? (
              <PluginPreviewRenderer
                file={file}
                registry={officePreviewRegistry}
                largeFilePolicy="off"
                onError={(error) => setPreviewError(error.message)}
              />
            ) : null}
          </LocaleProvider>
        </div>
      </div>
      {isXlsx && xlsxEmptyGrid ? (
        <>
          <div
            className="office-xlsx-corner-header"
            aria-hidden="true"
            style={{
              left: xlsxEmptyGrid.rowHeaderLeft,
              top: xlsxEmptyGrid.headerTop,
              width: xlsxEmptyGrid.rowHeaderWidth,
              height: xlsxEmptyGrid.headerHeight,
            }}
          />
          <div
            ref={xlsxRowHeadersRef}
            className="office-xlsx-row-headers"
            aria-hidden="true"
            style={{
              left: xlsxEmptyGrid.rowHeaderLeft,
              width: xlsxEmptyGrid.rowHeaderWidth,
              fontSize: Math.max(6, Math.round((11 * xlsxZoom) / 100)),
            }}
          >
            {xlsxEmptyGrid.rowHeaders.map((row, index) => (
              <span
                key={`${row.label}-${index}`}
                style={{ top: row.top, height: row.height }}
              >
                {row.label}
              </span>
            ))}
          </div>
          <div
            ref={xlsxColumnHeadersRef}
            className="office-xlsx-column-headers"
            aria-hidden="true"
            style={{
              top: xlsxEmptyGrid.headerTop,
              height: xlsxEmptyGrid.headerHeight,
              fontSize: Math.max(6, Math.round((11 * xlsxZoom) / 100)),
            }}
          >
            {xlsxEmptyGrid.columnHeaders.map((column, index) => (
              <span
                key={`${column.label}-${index}`}
                style={{ left: column.left, width: column.width }}
              >
                {column.label}
              </span>
            ))}
          </div>
          <div
            ref={xlsxEmptyGridRef}
            className="office-xlsx-empty-grid"
            aria-hidden="true"
            style={{ left: xlsxEmptyGrid.left, width: xlsxEmptyGrid.width }}
          >
            {xlsxEmptyGrid.rows.map((row, index) => (
              <div
                key={`${row.top}-${index}`}
                className="office-xlsx-empty-grid-row"
                style={{ top: row.top, height: row.height }}
              >
                {xlsxEmptyGrid.labels.map((label) => (
                  <span key={label} style={{ width: xlsxZoom }} />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}
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

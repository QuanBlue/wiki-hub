import JSZip from "jszip";

/**
 * Corrections applied to a workbook before it reaches the preview renderer.
 *
 * Both are compensations for how the renderer reads the file, so they are made
 * to a throwaway in-memory copy. The stored attachment is never touched.
 */

// Rows never nest, and their attributes are numeric or boolean, so no attribute
// value can contain the `>` that ends the opening tag.
const ROW_PATTERN = /<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
const CELL_PATTERN = /<c[\s>]/;
const WORKSHEET_PATTERN = /^xl\/worksheets\/sheet[^/]*\.xml$/;
const STYLES_PATH = "xl/styles.xml";

// `<sz val="10"/>` in a workbook means 10 *points*; the renderer emits it as
// `font-size: 10px`. CSS pixels are 96/72 of a point.
const POINTS_TO_PIXELS = 4 / 3;
const FONT_SIZE_PATTERN = /(<sz\b[^>]*\bval=")([0-9.]+)(")/g;

// Indexes 0-63 are the legacy colour palette. 64 and 65 are not colours at all
// but the system foreground and background - Excel's "Automatic" - which a
// palette lookup cannot resolve. `<color>` appears only inside `<font>` and
// `<border>`; fills use `<fgColor>`/`<bgColor>`, so this cannot repaint a cell.
const SYSTEM_COLORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<color\b[^>]*\bindexed="64"[^>]*(?:\/>|><\/color>)/g, '<color rgb="FF000000"/>'],
  [/<color\b[^>]*\bindexed="65"[^>]*(?:\/>|><\/color>)/g, '<color rgb="FFFFFFFF"/>'],
];

function lastRowNumber(rowMarkup: string): number {
  const reference = /<row\b[^>]*\br="(\d+)"/.exec(rowMarkup);
  return reference ? Number.parseInt(reference[1], 10) : 0;
}

/**
 * Remove trailing cell-less rows from one worksheet, and shrink the declared
 * dimension to match. Returns null when the sheet needs no change.
 *
 * Spreadsheets exported by Excel, LibreOffice or Google Sheets often carry a
 * handful of trailing `<row>` elements that hold nothing but a row height -
 * frequently at the very bottom of the sheet (row 1048576). Excel ignores them
 * when it computes the used range, but ExcelJS reports `rowCount` from the last
 * row element it parsed, so the renderer inflates a 29-row workbook into a
 * million-row grid: bogus dimensions in the header, thousands of empty pages,
 * and a cell grid large enough to stall the browser.
 */
export function trimWorksheetPhantomRows(sheetXml: string): string | null {
  const rows = [...sheetXml.matchAll(ROW_PATTERN)];
  if (rows.length === 0) return null;

  let lastPopulated = -1;
  rows.forEach((row, index) => {
    if (CELL_PATTERN.test(row[0])) lastPopulated = index;
  });
  if (lastPopulated === rows.length - 1) return null;

  // Splice from the end so the earlier match offsets stay valid.
  let trimmed = sheetXml;
  for (let index = rows.length - 1; index > lastPopulated; index -= 1) {
    const row = rows[index];
    const start = row.index ?? 0;
    trimmed = trimmed.slice(0, start) + trimmed.slice(start + row[0].length);
  }

  // A sheet with no populated row at all still needs a valid dimension, so
  // clamp to row 1 rather than emitting an empty reference.
  const usedRows = lastPopulated >= 0 ? lastRowNumber(rows[lastPopulated][0]) : 1;
  return trimmed.replace(
    /(<dimension\b[^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)"/,
    (match, prefix: string, endRow: string) =>
      Number.parseInt(endRow, 10) > usedRows ? `${prefix}${usedRows}"` : match,
  );
}

/**
 * Restate every font size in the stylesheet as the pixel count it should
 * occupy. Returns null when the stylesheet declares no font size.
 *
 * The renderer writes a cell's font size straight into `font-size: <n>px`,
 * while the workbook states it in points - so a 10 pt sheet rendered at 10 px
 * comes out a quarter too small against row heights and column widths, which
 * the same renderer *does* convert. Rewriting the sizes here is what makes the
 * preview's proportions match Excel.
 */
export function scaleFontSizesToPixels(stylesXml: string): string | null {
  let changed = false;
  const scaled = stylesXml.replace(
    FONT_SIZE_PATTERN,
    (match, prefix: string, value: string, suffix: string) => {
      const points = Number.parseFloat(value);
      if (!Number.isFinite(points) || points <= 0) return match;
      changed = true;
      const pixels = Math.round(points * POINTS_TO_PIXELS * 100) / 100;
      return `${prefix}${pixels}${suffix}`;
    },
  );
  return changed ? scaled : null;
}

/**
 * Replace Excel's two "Automatic" colour indexes with the colours they stand
 * for. Returns null when the stylesheet uses neither.
 *
 * The renderer resolves a `<color indexed="n"/>` through a 64-entry palette, so
 * 64 (system foreground) and 65 (system background) resolve to nothing at all
 * and the cell silently inherits whatever colour the page has. White bold text
 * on a dark header - written as index 65 - comes out unreadable.
 */
export function resolveSystemIndexedColors(stylesXml: string): string | null {
  let resolved = stylesXml;
  for (const [pattern, replacement] of SYSTEM_COLORS) {
    resolved = resolved.replace(pattern, replacement);
  }
  return resolved === stylesXml ? null : resolved;
}

/**
 * Rebuild a workbook for the preview renderer. Returns the original buffer
 * untouched when nothing needed correcting, so a healthy workbook is never
 * re-zipped.
 */
export async function prepareWorkbookForPreview(
  workbook: ArrayBuffer,
): Promise<ArrayBuffer> {
  // JSZip is handed a view rather than the buffer itself: an ArrayBuffer
  // created in another realm fails its `instanceof` check, a typed array does
  // not.
  const archive = await JSZip.loadAsync(new Uint8Array(workbook));
  let changed = false;

  const worksheets = Object.keys(archive.files).filter((path) =>
    WORKSHEET_PATTERN.test(path),
  );
  for (const path of worksheets) {
    const trimmed = trimWorksheetPhantomRows(await archive.files[path].async("string"));
    if (trimmed === null) continue;
    archive.file(path, trimmed);
    changed = true;
  }

  const styles = archive.files[STYLES_PATH];
  if (styles) {
    const original = await styles.async("string");
    let corrected = scaleFontSizesToPixels(original) ?? original;
    corrected = resolveSystemIndexedColors(corrected) ?? corrected;
    if (corrected !== original) {
      archive.file(STYLES_PATH, corrected);
      changed = true;
    }
  }

  if (!changed) return workbook;
  return archive.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

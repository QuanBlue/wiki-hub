import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  prepareWorkbookForPreview,
  resolveSystemIndexedColors,
  scaleFontSizesToPixels,
  trimWorksheetPhantomRows,
} from "@/lib/xlsx-preview-workbook";

const populatedRows = [
  '<row r="1" ht="12.75"><c r="A1" s="1" t="s"><v>0</v></c></row>',
  '<row r="2" ht="12.75"><c r="A2" s="5"><v>1</v></c><c r="B2" s="6"/></row>',
].join("");

function sheetXml(body: string, dimension = "") {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    dimension +
    `<sheetData>${body}</sheetData>` +
    "</worksheet>"
  );
}

describe("trimWorksheetPhantomRows", () => {
  it("drops trailing rows that carry no cells", () => {
    const trimmed = trimWorksheetPhantomRows(
      sheetXml(
        `${populatedRows}<row r="1048575" ht="12.8"></row><row r="1048576" ht="12.8"/>`,
      ),
    );

    expect(trimmed).not.toBeNull();
    expect(trimmed).toContain('<row r="2"');
    expect(trimmed).not.toContain("1048575");
    expect(trimmed).not.toContain("1048576");
  });

  it("shrinks a declared dimension to the last populated row", () => {
    const trimmed = trimWorksheetPhantomRows(
      sheetXml(
        `${populatedRows}<row r="1048576" ht="12.8"/>`,
        '<dimension ref="A1:G1048576"/>',
      ),
    );

    expect(trimmed).toContain('<dimension ref="A1:G2"/>');
  });

  it("keeps empty rows that sit between populated ones", () => {
    const trimmed = trimWorksheetPhantomRows(
      sheetXml(
        `<row r="1" ht="12.75"><c r="A1"><v>1</v></c></row><row r="2" ht="12.8"/><row r="3"><c r="A3"><v>3</v></c></row>`,
      ),
    );

    expect(trimmed).toBeNull();
  });

  it("leaves a sheet that already ends on a populated row alone", () => {
    expect(trimWorksheetPhantomRows(sheetXml(populatedRows))).toBeNull();
  });

  it("treats a styled but valueless cell as real content", () => {
    const trimmed = trimWorksheetPhantomRows(
      sheetXml(`${populatedRows}<row r="3" ht="12.8"><c r="A3" s="4"/></row>`),
    );

    expect(trimmed).toBeNull();
  });
});

describe("prepareWorkbookForPreview", () => {
  async function buildWorkbook(sheets: Record<string, string>) {
    const archive = new JSZip();
    archive.file("[Content_Types].xml", "<Types/>");
    for (const [path, xml] of Object.entries(sheets)) archive.file(path, xml);
    return archive.generateAsync({ type: "arraybuffer" });
  }

  it("rewrites every worksheet that ends in phantom rows", async () => {
    const source = await buildWorkbook({
      "xl/worksheets/sheet1.xml": sheetXml(
        `${populatedRows}<row r="1048576" ht="12.8"/>`,
      ),
      "xl/worksheets/sheet2.xml": sheetXml(
        `${populatedRows}<row r="900000" ht="12.8"></row>`,
      ),
    });

    const archive = await JSZip.loadAsync(
      await prepareWorkbookForPreview(source),
    );

    expect(await archive.file("xl/worksheets/sheet1.xml")?.async("string")).not.toContain(
      "1048576",
    );
    expect(await archive.file("xl/worksheets/sheet2.xml")?.async("string")).not.toContain(
      "900000",
    );
    expect(archive.file("[Content_Types].xml")).not.toBeNull();
  });

  it("returns the original bytes when nothing needs correcting", async () => {
    const source = await buildWorkbook({
      "xl/worksheets/sheet1.xml": sheetXml(populatedRows),
    });

    expect(await prepareWorkbookForPreview(source)).toBe(source);
  });

  it("restates the stylesheet's font sizes in pixels", async () => {
    const source = await buildWorkbook({
      "xl/worksheets/sheet1.xml": sheetXml(populatedRows),
      "xl/styles.xml":
        '<styleSheet><fonts count="2">' +
        '<font><sz val="10.000000"/><name val="Arial"/></font>' +
        '<font><b/><sz val="9.75"/><name val="Arial"/></font>' +
        "</fonts></styleSheet>",
    });

    const archive = await JSZip.loadAsync(await prepareWorkbookForPreview(source));
    const styles = await archive.file("xl/styles.xml")?.async("string");

    expect(styles).toContain('<sz val="13.33"/>');
    expect(styles).toContain('<sz val="13"/>');
    expect(styles).toContain('<name val="Arial"/>');
  });
});


describe("scaleFontSizesToPixels", () => {
  it("converts every declared point size to its pixel equivalent", () => {
    const scaled = scaleFontSizesToPixels(
      '<fonts><font><sz val="10"/></font><font><sz val="12.000000"/></font></fonts>',
    );

    expect(scaled).toBe('<fonts><font><sz val="13.33"/></font><font><sz val="16"/></font></fonts>');
  });

  it("leaves a stylesheet with no font size alone", () => {
    expect(scaleFontSizesToPixels("<styleSheet><fills/></styleSheet>")).toBeNull();
  });

  it("ignores a size it cannot read as a positive number", () => {
    const scaled = scaleFontSizesToPixels('<fonts><font><sz val="0"/></font></fonts>');

    expect(scaled).toBeNull();
  });
});


describe("resolveSystemIndexedColors", () => {
  it("turns Excel's two Automatic indexes into real colours", () => {
    const resolved = resolveSystemIndexedColors(
      '<fonts><font><b/><sz val="13"/><color indexed="65"/></font>' +
        '<font><sz val="13"/><color indexed="64"/></font></fonts>',
    );

    // 65 is the system background: white bold text on a dark header.
    expect(resolved).toContain('<color rgb="FFFFFFFF"/>');
    // 64 is the system foreground, which Excel paints black.
    expect(resolved).toContain('<color rgb="FF000000"/>');
    expect(resolved).not.toContain("indexed");
  });

  it("leaves palette indexes and theme colours alone", () => {
    const stylesheet =
      '<fonts><font><color indexed="2"/></font><font><color theme="1" tint="0.5"/></font></fonts>';

    expect(resolveSystemIndexedColors(stylesheet)).toBeNull();
  });

  it("does not touch a fill, which uses fgColor and bgColor", () => {
    // Repainting a cell background would be a far worse bug than the one this
    // fixes, so the pattern deliberately matches only `<color>`.
    const fills =
      '<fills><fill><patternFill patternType="solid">' +
      '<fgColor rgb="FFC00000"/><bgColor indexed="64"/></patternFill></fill></fills>';

    expect(resolveSystemIndexedColors(fills)).toBeNull();
  });

  it("handles the long-form element and extra attributes", () => {
    const resolved = resolveSystemIndexedColors(
      '<font><color indexed="65" tint="0.2"></color></font>',
    );

    expect(resolved).toBe('<font><color rgb="FFFFFFFF"/></font>');
  });
});

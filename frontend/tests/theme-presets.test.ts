import { describe, expect, it } from "vitest";

import {
  THEME_COLOR_PRESETS,
  generateFaviconSvg,
  generatePaletteFromHex,
  getPresetOrCustomPalette,
} from "@/lib/theme-presets";

describe("THEME_COLOR_PRESETS", () => {
  it("every preset's primary and full palette are valid 6-digit hex colors", () => {
    for (const preset of THEME_COLOR_PRESETS) {
      expect(preset.primary).toMatch(/^#[0-9a-f]{6}$/i);
      for (const shade of Object.values(preset.palette)) {
        expect(shade).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("has no duplicate ids", () => {
    const ids = THEME_COLOR_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generatePaletteFromHex", () => {
  it("uses the given color as shade 500, zero-padded", () => {
    expect(generatePaletteFromHex("#216fc0")[500]).toBe("#216fc0");
  });

  it("expands a 3-digit shorthand hex", () => {
    // #f00 -> #ff0000
    expect(generatePaletteFromHex("#f00")[500]).toBe("#ff0000");
  });

  it("accepts a hex without a leading #", () => {
    expect(generatePaletteFromHex("216fc0")[500]).toBe("#216fc0");
  });

  it("lighter shades progress toward white, darker shades toward black", () => {
    const toBrightness = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const palette = generatePaletteFromHex("#808080");

    expect(toBrightness(palette[50])).toBeGreaterThan(toBrightness(palette[100]));
    expect(toBrightness(palette[100])).toBeGreaterThan(toBrightness(palette[400]));
    expect(toBrightness(palette[900])).toBeLessThan(toBrightness(palette[800]));
    expect(toBrightness(palette[800])).toBeLessThan(toBrightness(palette[600]));
  });

  it("falls back to the first preset's palette for unparseable input", () => {
    expect(generatePaletteFromHex("not-a-color")).toEqual(THEME_COLOR_PRESETS[0].palette);
  });
});

describe("getPresetOrCustomPalette", () => {
  it("returns the matching built-in preset by id, case-insensitively", () => {
    const emerald = THEME_COLOR_PRESETS.find((p) => p.id === "emerald")!;
    expect(getPresetOrCustomPalette("emerald")).toBe(emerald.palette);
    expect(getPresetOrCustomPalette("EMERALD")).toBe(emerald.palette);
  });

  it("generates a palette from a custom hex not matching any preset", () => {
    expect(getPresetOrCustomPalette("#123456")).toEqual(generatePaletteFromHex("#123456"));
  });

  it("falls back to the first preset for null, undefined, empty, or unrecognised input", () => {
    expect(getPresetOrCustomPalette(null)).toBe(THEME_COLOR_PRESETS[0].palette);
    expect(getPresetOrCustomPalette(undefined)).toBe(THEME_COLOR_PRESETS[0].palette);
    expect(getPresetOrCustomPalette("")).toBe(THEME_COLOR_PRESETS[0].palette);
    expect(getPresetOrCustomPalette("not-a-preset-or-hex")).toBe(THEME_COLOR_PRESETS[0].palette);
  });
});

describe("generateFaviconSvg", () => {
  it("embeds the given background color", () => {
    expect(generateFaviconSvg("book", "#123456")).toContain('fill="#123456"');
  });

  it("falls back to the WikiHub blue when no color is given", () => {
    expect(generateFaviconSvg("book", "")).toContain('fill="#216fc0"');
  });

  it("produces a distinct icon per known icon id", () => {
    const icons = [
      "book", "layers", "compass", "sparkles", "feather",
      "hub", "graduation", "cpu", "shield",
    ];
    const svgs = new Set(icons.map((icon) => generateFaviconSvg(icon, "#000000")));
    expect(svgs.size).toBe(icons.length);
  });

  it("renders a default icon for an unrecognised id rather than throwing", () => {
    expect(() => generateFaviconSvg("not-a-real-icon", "#000000")).not.toThrow();
    expect(generateFaviconSvg("not-a-real-icon", "#000000")).toContain("<svg");
  });

  it("is a well-formed SVG document", () => {
    const svg = generateFaviconSvg("book", "#216fc0");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

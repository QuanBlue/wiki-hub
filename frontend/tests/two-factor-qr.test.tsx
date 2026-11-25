import { describe, expect, it } from "vitest";

import { generateQrMatrix, generateQrSvg } from "@/lib/qr-svg";

describe("QR SVG generator (offline)", () => {
  it("generates a valid Version 1 matrix with 7x7 finder patterns and intact dark module", () => {
    const matrix = generateQrMatrix("HELLO");
    const size = matrix.length;
    expect(size).toBe(21);
    expect(matrix[0]?.length).toBe(21);

    // Top-left 7x7 finder pattern outer ring is dark, inner 3x3 is dark
    for (let i = 0; i < 7; i += 1) {
      expect(matrix[0]![i]).toBe(true);
      expect(matrix[6]![i]).toBe(true);
      expect(matrix[i]![0]).toBe(true);
      expect(matrix[i]![6]).toBe(true);
    }
    expect(matrix[3]![3]).toBe(true);
    // Separator around top-left finder is light
    expect(matrix[7]![0]).toBe(false);
    expect(matrix[0]![7]).toBe(false);
    // ISO/IEC 18004 fixed dark module at (4 * version + 9, 8) = (size - 8, 8)
    expect(matrix[size - 8]![8]).toBe(true);
  });

  it("generates a crisp, standards-compliant inline SVG for otpauth://totp URIs", () => {
    const uri =
      "otpauth://totp/WikiHub:alice%40example.com?secret=S6YV2MP4NLTZMGCDA35WNW5J6IKUGLNK&issuer=WikiHub&algorithm=SHA1&digits=6&period=30";
    const matrix = generateQrMatrix(uri);
    const size = matrix.length;
    // Fixed dark module must remain dark and format copies must agree
    expect(matrix[size - 8]![8]).toBe(true);
    expect(matrix[8]![0]).toBe(matrix[size - 1]![8]);
    expect(matrix[8]![1]).toBe(matrix[size - 2]![8]);
    expect(matrix[0]![8]).toBe(matrix[8]![size - 1]);

    const svg = generateQrSvg(uri, { size: 192 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="192" height="192"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("https://");
  });

  it("supports longer URIs requiring Version 7+ (version info bits)", () => {
    const longUri =
      "otpauth://totp/Enterprise%20Knowledge%20Workspace:very.long.username.for.testing@subdomain.company.example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Enterprise%20Knowledge%20Workspace";
    const matrix = generateQrMatrix(longUri);
    expect(matrix.length).toBeGreaterThanOrEqual(45);
    expect(matrix[matrix.length - 8]![8]).toBe(true);
    const svg = generateQrSvg(longUri);
    expect(svg).toContain("<path d=");
  });

  it("throws on empty input", () => {
    expect(() => generateQrMatrix("")).toThrow(/empty/i);
  });
});

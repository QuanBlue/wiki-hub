/**
 * Offline ISO/IEC 18004 QR Code SVG generator backed by the standard `qrcode` library.
 *
 * Used for TOTP `otpauth://` URIs so authenticator secrets never leave the browser
 * or get sent to any third-party QR rendering service.
 */

import QRCode from "qrcode";

/** Generate a 2D boolean QR module matrix (`true` = dark module). */
export function generateQrMatrix(text: string): boolean[][] {
  if (!text) {
    throw new Error("QR code input must not be empty.");
  }
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const matrix: boolean[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c += 1) {
      row.push(Boolean(qr.modules.get(r, c)));
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Render a crisp, scannable QR code as an inline SVG string.
 * Uses a 4-module white quiet zone and `#000000` modules for reliable scanning in any theme.
 */
export function generateQrSvg(
  text: string,
  options: { quietZone?: number; size?: number } = {},
): string {
  const quietZone = options.quietZone ?? 4;
  const matrix = generateQrMatrix(text);
  const n = matrix.length;
  const viewSize = n + quietZone * 2;
  const parts: string[] = [];

  for (let r = 0; r < n; r += 1) {
    const row = matrix[r]!;
    let c = 0;
    while (c < n) {
      if (!row[c]) {
        c += 1;
        continue;
      }
      const start = c;
      while (c < n && row[c]) c += 1;
      const runWidth = c - start;
      parts.push(`M${start + quietZone},${r + quietZone}h${runWidth}v1h-${runWidth}z`);
    }
  }

  const sizeAttr = options.size ? ` width="${options.size}" height="${options.size}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}"${sizeAttr} shape-rendering="crispEdges" role="img">`,
    `<rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/>`,
    `<path d="${parts.join("")}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}

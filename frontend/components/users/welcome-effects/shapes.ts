/** Small reusable canvas shapes for the newer welcome themes. */
import type { Focus } from "@/components/users/welcome-effects/engine";
import { hash } from "@/components/users/welcome-effects/helpers";

export const TAU = Math.PI * 2;

/**
 * Height of the app's top bar (56px). The welcome overlay covers the whole
 * window, but full-width bands (ribbons, friezes) belong to the content area
 * below the top bar, so they start here instead of at the window's top edge.
 */
export const TOPBAR_H = 56;
export const INK = "#1f2937";

export function fs(
  ctx: CanvasRenderingContext2D,
  fill: string | null,
  stroke: string | null = INK,
  lw = 1.2,
) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** x position biased towards the left/right edges so the middle of Home stays readable. */
export function edgeX(seed: number, w: number, band = 0.3): number {
  const u = hash(seed) * band * w;
  return hash(seed + 7) < 0.5 ? u : w - u;
}

export function focusOr(f: Focus | undefined, w: number, h: number): Focus {
  return f ?? { x: w / 2, y: h * 0.4, r: Math.max(16, Math.min(w, h) * 0.1) };
}

export function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.2, x - s * 0.7, y - s * 1.1, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.5, y - s * 0.2, x, y + s * 0.9);
  ctx.closePath();
}

export function starPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  r: number,
  n = 5,
  rot = -Math.PI / 2,
) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = rot + (i / (n * 2)) * TAU;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function cloudPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x - s * 1.1, y + s * 0.4);
  ctx.arc(x - s * 0.8, y, s * 0.45, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(x - s * 0.25, y - s * 0.4, s * 0.55, Math.PI, Math.PI * 1.95);
  ctx.arc(x + s * 0.5, y - s * 0.1, s * 0.5, Math.PI * 1.3, Math.PI * 0.5);
  ctx.closePath();
}

export function drawGear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  teeth: number,
  rot: number,
  fill: string,
  stroke = INK,
) {
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = rot + (i / teeth) * TAU;
    const a1 = a0 + (TAU / teeth) * 0.28;
    const a2 = a0 + (TAU / teeth) * 0.5;
    const a3 = a0 + (TAU / teeth) * 0.78;
    const ro = R;
    const ri = R * 0.78;
    ctx.lineTo(x + Math.cos(a0) * ri, y + Math.sin(a0) * ri);
    ctx.lineTo(x + Math.cos(a1) * ro, y + Math.sin(a1) * ro);
    ctx.lineTo(x + Math.cos(a2) * ro, y + Math.sin(a2) * ro);
    ctx.lineTo(x + Math.cos(a3) * ri, y + Math.sin(a3) * ri);
  }
  ctx.closePath();
  fs(ctx, fill, stroke, Math.max(1, R * 0.06));
  ctx.beginPath();
  ctx.arc(x, y, R * 0.28, 0, TAU);
  fs(ctx, "rgba(255,255,255,0.35)", stroke, Math.max(1, R * 0.05));
}

export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
  font = "system-ui, sans-serif",
) {
  ctx.font = `900 ${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Isometric cube centred at (x, y) with side `s`. */
export function isoCube(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  top: string,
  left: string,
  right: string,
) {
  const hw = s * 0.87;
  const q = s * 0.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + hw, y - q);
  ctx.lineTo(x, y);
  ctx.lineTo(x - hw, y - q);
  ctx.closePath();
  fs(ctx, top, INK, 1);
  ctx.beginPath();
  ctx.moveTo(x - hw, y - q);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - hw, y + q);
  ctx.closePath();
  fs(ctx, left, INK, 1);
  ctx.beginPath();
  ctx.moveTo(x + hw, y - q);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x + hw, y + q);
  ctx.closePath();
  fs(ctx, right, INK, 1);
}

/** Shared maths and small canvas helpers for the welcome effects. */

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** Opening → climax → dissolve envelope shared by every theme (0..1). */
export function envelope(t: number): number {
  return smooth(t / 0.14) * (1 - smooth((t - 0.76) / 0.24));
}

/** Deterministic pseudo-random in [0, 1) so glitches don't depend on frame rate. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Four-point sparkle with an optional dark outline so it stays visible on white. */
export function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string | null,
  alpha: number,
) {
  if (alpha <= 0.01 || radius <= 0.2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 2.1);
  ctx.quadraticCurveTo(x, y, x + radius * 2.1, y);
  ctx.quadraticCurveTo(x, y, x, y + radius * 2.1);
  ctx.quadraticCurveTo(x, y, x - radius * 2.1, y);
  ctx.quadraticCurveTo(x, y, x, y - radius * 2.1);
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.restore();
}

/** Soft glow disc (cheaper than shadowBlur for many particles). */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number,
) {
  if (alpha <= 0.005 || r <= 0.3) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

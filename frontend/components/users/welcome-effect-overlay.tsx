"use client";

import {
  Crown,
  Flame,
  Fish,
  Flower2,
  Gamepad2,
  Lamp,
  Orbit,
  PartyPopper,
  Snowflake,
  Sparkles,
  Sunset,
  Terminal,
  Waves,
  X,
  Zap,
  CloudLightning,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { WelcomeEffect } from "@/types/api";

interface WelcomeEffectOverlayProps {
  effect: WelcomeEffect;
  ownerName: string;
  message?: string;
  onComplete: () => void;
  /** Render inside a parent container (`absolute inset-0`) instead of full viewport (`fixed inset-0`). */
  contained?: boolean;
}

const DURATION_MS = 4000;
const FADE_START_MS = 3200;

const MATRIX_CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ABCDEF<>{}[]#$%&*";

type FrameRenderer = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsedMs: number,
) => void;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** Opening → climax → dissolve envelope shared by every theme (0..1). */
function envelope(t: number): number {
  return smooth(t / 0.14) * (1 - smooth((t - 0.76) / 0.24));
}

/** Deterministic pseudo-random in [0, 1) so glitches don't depend on frame rate. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Four-point sparkle with an optional dark outline so it stays visible on white. */
function drawSparkle(
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
function drawGlow(
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

/* ------------------------------------------------------------------ */
/* Phoenix                                                             */
/* ------------------------------------------------------------------ */

function featherPath(ctx: CanvasRenderingContext2D, len: number, wid: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.22, -wid * 1.0, len * 0.68, -wid * 0.85, len, -wid * 0.08);
  ctx.bezierCurveTo(len * 0.72, wid * 0.5, len * 0.3, wid * 0.72, 0, 0);
  ctx.closePath();
}

function createPhoenixRenderer(initW: number, initH: number): FrameRenderer {
  interface Ember {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    decay: number;
    angle: number;
    spin: number;
    flip: number;
    kind: "spark" | "feather";
    color: string;
  }

  const palette = ["#fde047", "#fb923c", "#f97316", "#ea580c", "#dc2626"];
  const embers: Ember[] = [];
  let lastMs = 0;

  const spawn = (w: number, h: number, count: number, burst: boolean) => {
    for (let i = 0; i < count; i += 1) {
      const feather = Math.random() > 0.7;
      const angle = burst
        ? -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.25
        : -Math.PI * 0.5 + (Math.random() - 0.5) * 0.6;
      const speed = burst ? 2 + Math.random() * 4.6 : 1.3 + Math.random() * 3;
      const m = Math.min(w, h);
      embers.push({
        x: burst ? w * 0.5 + (Math.random() - 0.5) * m * 0.12 : w * (0.04 + Math.random() * 0.92),
        y: burst ? h * 0.62 + (Math.random() - 0.5) * m * 0.08 : h + Math.random() * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (feather ? 0.022 + Math.random() * 0.02 : 0.005 + Math.random() * 0.008) * m + 1,
        life: 0.85 + Math.random() * 0.15,
        decay: burst ? 0.006 + Math.random() * 0.006 : 0.004 + Math.random() * 0.005,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.09,
        flip: Math.random() * Math.PI * 2,
        kind: feather ? "feather" : "spark",
        color: palette[Math.floor(Math.random() * palette.length)]!,
      });
    }
  };
  spawn(initW, initH, 46, true);
  spawn(initW, initH, 34, false);

  const drawWing = (
    ctx: CanvasRenderingContext2D,
    side: -1 | 1,
    rootX: number,
    rootY: number,
    span: number,
    wid: number,
    flap: number,
    alpha: number,
    layer: 0 | 1,
  ) => {
    const count = layer === 0 ? 9 : 7;
    for (let i = 0; i < count; i += 1) {
      const r = i / (count - 1);
      // Leading feather sweeps up/outward, trailing ones droop toward the horizon.
      const ang = lerp(-1.32, 0.18, r) + flap * (0.4 + r * 0.8);
      const len = span * (layer === 0 ? 1 : 0.62) * (0.62 + 0.38 * Math.sin(Math.PI * (0.12 + r * 0.8)));
      const fw = wid * (layer === 0 ? 1 : 0.8);

      ctx.save();
      ctx.translate(rootX, rootY);
      ctx.scale(side, 1);
      ctx.rotate(ang);

      const g = ctx.createLinearGradient(0, 0, len, 0);
      if (layer === 0) {
        g.addColorStop(0, `rgba(254, 240, 138, ${0.9 * alpha})`);
        g.addColorStop(0.3, `rgba(251, 146, 60, ${0.82 * alpha})`);
        g.addColorStop(0.7, `rgba(220, 38, 38, ${0.72 * alpha})`);
        g.addColorStop(1, `rgba(127, 29, 29, ${0.1 * alpha})`);
      } else {
        g.addColorStop(0, `rgba(255, 251, 235, ${0.95 * alpha})`);
        g.addColorStop(0.45, `rgba(253, 224, 71, ${0.8 * alpha})`);
        g.addColorStop(1, `rgba(249, 115, 22, ${0.05 * alpha})`);
      }
      ctx.fillStyle = g;
      featherPath(ctx, len, fw);
      ctx.fill();
      // Thin dark-red edge keeps the plumage legible on a white page.
      ctx.strokeStyle = `rgba(153, 27, 27, ${0.38 * alpha})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      // Rachis (central quill).
      ctx.strokeStyle = `rgba(255, 247, 214, ${0.65 * alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -fw * 0.28, len * 0.94, -fw * 0.07);
      ctx.stroke();
      ctx.restore();
    }
  };

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const cx = w * 0.5;
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Furnace glow rising from the bottom edge (source-over → vivid on white and dark).
    const pulse = 0.9 + Math.sin(elapsedMs * 0.007) * 0.1;
    const furnace = ctx.createRadialGradient(cx, h * 1.05, 0, cx, h * 1.0, h * 0.8);
    furnace.addColorStop(0, `rgba(249, 115, 22, ${0.5 * pulse * env})`);
    furnace.addColorStop(0.5, `rgba(220, 38, 38, ${0.2 * pulse * env})`);
    furnace.addColorStop(1, "rgba(220, 38, 38, 0)");
    ctx.fillStyle = furnace;
    ctx.fillRect(0, 0, w, h);

    // 2. Wall of flame tongues along the bottom edge.
    const tongues = Math.max(9, Math.round(w / 56));
    const rise = easeOutCubic(clamp01(t / 0.3));
    for (let i = 0; i < tongues; i += 1) {
      const u = (i + 0.5) / tongues;
      const edge = 0.5 + 0.5 * Math.abs(u - 0.5) * 2; // taller toward the sides, clear centre
      const flick =
        0.7 + 0.3 * Math.sin(elapsedMs * 0.011 + i * 1.7) * Math.sin(elapsedMs * 0.0053 + i * 0.6);
      const fh = h * 0.2 * rise * edge * flick * env;
      const fw = (w / tongues) * 0.78;
      const x = u * w;
      const sway = Math.sin(elapsedMs * 0.006 + i) * fw * 0.25;
      const g = ctx.createLinearGradient(0, h, 0, h - fh);
      g.addColorStop(0, "rgba(254, 240, 138, 0.95)");
      g.addColorStop(0.35, "rgba(249, 115, 22, 0.8)");
      g.addColorStop(1, "rgba(185, 28, 28, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - fw * 0.5, h + 2);
      ctx.bezierCurveTo(x - fw * 0.55, h - fh * 0.4, x + sway * 0.4, h - fh * 0.7, x + sway, h - fh);
      ctx.bezierCurveTo(x + fw * 0.55, h - fh * 0.62, x + fw * 0.5, h - fh * 0.3, x + fw * 0.5, h + 2);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Rebirth shockwave (double ring, amber → gold).
    [0.04, 0.14].forEach((delay, idx) => {
      const p = clamp01((t - delay) / 0.36);
      if (p <= 0 || p >= 1) return;
      const r = easeOutCubic(p) * m * (idx === 0 ? 0.74 : 0.56);
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.strokeStyle = idx === 0 ? "#ea580c" : "#f59e0b";
      ctx.lineWidth = (1 - p) * (idx === 0 ? 5 : 3) + 0.5;
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(249, 115, 22, 0.7)";
      ctx.beginPath();
      ctx.arc(cx, h * 0.62, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // 4. Layered phoenix wings.
    const spread = easeOutBack(clamp01((t - 0.03) / 0.3));
    const wingA = env * clamp01(spread * 1.2);
    if (wingA > 0.01) {
      const flap = Math.sin(elapsedMs * 0.0058) * 0.07 * (1 - smooth((t - 0.5) / 0.3) * 0.6);
      const span = m * 0.56 * Math.max(0, spread);
      const rootX = cx + 0;
      const rootY = h * 0.66;
      for (const side of [-1, 1] as const) {
        const off = side * m * 0.05;
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = "rgba(194, 65, 12, 0.45)";
        drawWing(ctx, side, rootX + off, rootY, span, m * 0.085, flap, wingA * 0.8, 0);
        ctx.restore();
        drawWing(ctx, side, rootX + off, rootY, span, m * 0.07, flap * 1.2, wingA * 0.85, 1);
      }
    }

    // 5. Counter-rotating spiral flame ribbons (3 stacked strokes: red halo → orange → white-gold core).
    for (const dir of [-1, 1] as const) {
      const steps = 30;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= steps; s += 1) {
        const u = s / steps;
        const y = h * (1.02 - u * 0.86);
        const x =
          cx +
          dir *
            Math.sin(u * Math.PI * 3.1 - elapsedMs * 0.0048 * dir) *
            m *
            0.22 *
            (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, u * 1.05)));
        pts.push([x, y]);
      }
      const layers: Array<[string, number]> = [
        [`rgba(220, 38, 38, ${0.2 * env})`, m * 0.03],
        [`rgba(249, 115, 22, ${0.5 * env})`, m * 0.016],
        [`rgba(254, 240, 138, ${0.9 * env})`, m * 0.005],
      ];
      for (const [color, lw] of layers) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, lw);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        ctx.restore();
      }
    }

    // 6. Embers and tumbling feathers.
    if (t < 0.72 && embers.length < 110) spawn(w, h, 2, false);
    for (let i = embers.length - 1; i >= 0; i -= 1) {
      const p = embers[i]!;
      p.x += (p.vx + Math.sin(p.y * 0.022 + elapsedMs * 0.003) * 0.4) * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 0.002 * dt;
      p.angle += p.spin * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.y < -30) {
        embers.splice(i, 1);
        continue;
      }
      const a = clamp01(p.life) * (0.4 + 0.6 * env);
      if (p.kind === "feather") {
        const f = Math.cos(elapsedMs * 0.006 + p.flip);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(Math.max(0.2, Math.abs(f)), 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = f >= 0 ? p.color : "#b91c1c";
        ctx.strokeStyle = "rgba(127, 29, 29, 0.7)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.quadraticCurveTo(p.size * 0.6, -p.size * 0.1, 0, p.size);
        ctx.quadraticCurveTo(-p.size * 0.6, -p.size * 0.1, 0, -p.size);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        drawGlow(ctx, p.x, p.y, p.size * 4, "249, 115, 22", 0.35);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fffbeb";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Hacker                                                              */
/* ------------------------------------------------------------------ */

/**
 * Clean "secure terminal" look: a dot grid revealed by a ripple, sparse
 * digital rain that fades out toward the centre, lock-on reticles, one scan
 * pass and an "ACCESS GRANTED" decrypt pill at the bottom edge.
 */
function createHackerRenderer(initW: number, initH: number): FrameRenderer {
  interface Drop {
    xr: number;
    y: number;
    speed: number;
    tail: number;
    glyphs: string[];
  }

  const randomGlyph = () => MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]!;
  const initM = Math.min(initW, initH);
  const initFont = Math.max(10, Math.min(13, initM * 0.034));
  const cols = Math.max(12, Math.floor(initW / (initFont * 1.7)));
  const drops: Drop[] = [];
  for (let c = 0; c < cols; c += 1) {
    const xr = (c + 0.5) / cols;
    const edge = Math.abs(xr - 0.5) * 2;
    if (Math.random() > 0.2 + 0.6 * edge) continue;
    const tail = 6 + Math.floor(Math.random() * 9);
    drops.push({
      xr,
      y: -Math.random() * initH * 0.9,
      speed: 0.004 + Math.random() * 0.005,
      tail,
      glyphs: Array.from({ length: tail }, randomGlyph),
    });
  }

  const TARGET = "ACCESS GRANTED";
  const SCRAMBLE = "01#$%&*<>/\\ABCDEF";

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const m = Math.min(w, h);
    const env = envelope(t);
    const font = Math.max(10, Math.min(13, m * 0.034));
    const frame = Math.floor(elapsedMs / 55);

    // Fully transparent each frame — the page underneath stays readable.
    ctx.clearRect(0, 0, w, h);

    // 1. Dot grid revealed by a ripple travelling out from the centre.
    const gap = Math.max(18, m * 0.06);
    const diag = Math.hypot(w, h) * 0.55;
    const front = easeOutCubic(clamp01(t / 0.45)) * diag;
    ctx.save();
    for (let y = gap * 0.5; y < h; y += gap) {
      for (let x = gap * 0.5; x < w; x += gap) {
        const d = Math.hypot(x - w / 2, y - h / 2);
        if (d > front) continue;
        const crest = Math.max(0, 1 - Math.abs(d - front) / (gap * 1.6));
        const a = (0.16 + crest * 0.7) * env;
        ctx.fillStyle = crest > 0.05 ? `rgba(6, 182, 212, ${a})` : `rgba(5, 150, 105, ${a})`;
        const s = 1.4 + crest * 1.6;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    ctx.restore();

    // 2. Sparse digital rain, strongest at the edges, faint over the centre.
    ctx.save();
    ctx.font = `500 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    for (const d of drops) {
      const x = d.xr * w;
      const edge = Math.abs(d.xr - 0.5) * 2;
      const mask = (0.12 + 0.88 * Math.pow(edge, 1.3)) * env;
      if (Math.random() > 0.9) d.glyphs[Math.floor(Math.random() * d.tail)] = randomGlyph();
      const headY = Math.floor(d.y / font) * font;
      for (let k = 0; k < d.tail; k += 1) {
        const y = headY - k * font;
        if (y < -font || y > h + font) continue;
        const fade = (1 - k / d.tail) * mask;
        if (k === 0) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = "rgba(16, 185, 129, 0.95)";
          ctx.fillStyle = `rgba(16, 185, 129, ${fade})`;
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle =
            k < 4 ? `rgba(5, 150, 105, ${0.8 * fade})` : `rgba(4, 120, 87, ${0.5 * fade})`;
        }
        ctx.fillText(d.glyphs[k]!, x, y);
      }
      d.y += d.speed * h;
      if (d.y - d.tail * font > h) d.y = -Math.random() * h * 0.3;
    }
    ctx.restore();

    // 3. One clean scan pass from top to bottom.
    if (t >= 0.08 && t <= 0.5) {
      const y = easeOutCubic((t - 0.08) / 0.42) * h;
      const wake = Math.max(24, m * 0.08);
      const g = ctx.createLinearGradient(0, y - wake, 0, y);
      g.addColorStop(0, "rgba(16, 185, 129, 0)");
      g.addColorStop(1, `rgba(16, 185, 129, ${0.16 * env})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, y - wake, w, wake);
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = "rgba(16, 185, 129, 0.9)";
      ctx.strokeStyle = `rgba(5, 150, 105, ${0.9 * env})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Lock-on reticles: brackets fly out from the centre and snap to the frame.
    const pad = Math.max(12, Math.min(24, m * 0.045));
    const arm = Math.max(16, Math.min(30, m * 0.07));
    const lock = clamp01((t - 0.04) / 0.32);
    const p = easeOutBack(lock);
    const insetX = lerp(w * 0.3, pad, p);
    const insetY = lerp(h * 0.3, pad, p);
    ctx.save();
    ctx.globalAlpha = env * smooth(lock * 4);
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(16, 185, 129, 0.7)";
    ctx.strokeStyle = "#059669";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const corners: Array<[number, number, number, number]> = [
      [insetX, insetY, 1, 1],
      [w - insetX, insetY, -1, 1],
      [insetX, h - insetY, 1, -1],
      [w - insetX, h - insetY, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.moveTo(x, y + sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * arm, y);
    }
    ctx.stroke();
    if (lock >= 1) {
      // Mid-edge ticks appear once the frame has locked.
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(8, 145, 178, 0.85)";
      ctx.lineWidth = 1.2;
      const tick = arm * 0.35;
      ctx.beginPath();
      ctx.moveTo(w / 2 - tick, pad);
      ctx.lineTo(w / 2 + tick, pad);
      ctx.moveTo(w / 2 - tick, h - pad);
      ctx.lineTo(w / 2 + tick, h - pad);
      ctx.moveTo(pad, h / 2 - tick);
      ctx.lineTo(pad, h / 2 + tick);
      ctx.moveTo(w - pad, h / 2 - tick);
      ctx.lineTo(w - pad, h / 2 + tick);
      ctx.stroke();
    }
    ctx.restore();

    // 5. Decrypt pill at the bottom edge: scrambled glyphs resolve into ACCESS GRANTED.
    const pillIn = smooth((t - 0.08) / 0.12);
    if (pillIn > 0.01) {
      const reveal = clamp01((t - 0.14) / 0.4);
      const resolved = Math.floor(reveal * TARGET.length);
      const pf = Math.max(11, Math.min(14, m * 0.038));
      ctx.save();
      ctx.font = `700 ${pf}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const prefix = "> ";
      const textW = ctx.measureText(prefix + TARGET + "_").width;
      const pw = textW + pf * 2;
      const ph = pf * 2.3;
      const px = w / 2 - pw / 2;
      const py = h - pad - arm * 0.4 - ph - Math.max(8, m * 0.03);
      ctx.globalAlpha = env * pillIn;
      ctx.translate(w / 2, py + ph / 2);
      ctx.scale(lerp(0.4, 1, easeOutCubic(pillIn)), 1);
      ctx.translate(-w / 2, -(py + ph / 2));

      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(16, 185, 129, 0.45)";
      ctx.fillStyle = "rgba(9, 9, 11, 0.86)";
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(16, 185, 129, 0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // progress hairline along the bottom of the pill
      ctx.fillStyle = "rgba(34, 211, 238, 0.85)";
      ctx.fillRect(px + ph / 2, py + ph - 3, (pw - ph) * reveal, 1.5);

      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      let cursorX = px + pf;
      const midY = py + ph / 2 - 1;
      ctx.fillStyle = "#34d399";
      ctx.fillText(prefix, cursorX, midY);
      cursorX += ctx.measureText(prefix).width;
      for (let i = 0; i < TARGET.length; i += 1) {
        const ch = TARGET[i]!;
        let glyph = ch;
        if (i >= resolved) {
          glyph =
            ch === " " ? " " : SCRAMBLE[Math.floor(hash(frame * 31 + i) * SCRAMBLE.length)]!;
          ctx.fillStyle = "rgba(110, 231, 183, 0.5)";
        } else {
          ctx.fillStyle = reveal >= 1 ? "#a7f3d0" : "#6ee7b7";
        }
        ctx.fillText(glyph, cursorX, midY);
        cursorX += ctx.measureText(ch).width;
      }
      if (Math.floor(elapsedMs / 380) % 2 === 0) {
        ctx.fillStyle = "#34d399";
        ctx.fillText("_", cursorX, midY);
      }
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Admin — "Royal Gala"                                                */
/* ------------------------------------------------------------------ */

/** Metallic gold used by every Admin element (diagonal multi-stop = brushed-metal look). */
function goldGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#92400e");
  g.addColorStop(0.25, "#fbbf24");
  g.addColorStop(0.45, "#fff7c2");
  g.addColorStop(0.62, "#f59e0b");
  g.addColorStop(1, "#78350f");
  return g;
}

function drawCrown(ctx: CanvasRenderingContext2D, cs: number, elapsedMs: number) {
  ctx.save();
  ctx.shadowBlur = cs * 0.25;
  ctx.shadowColor = "rgba(120, 53, 15, 0.5)";
  const gold = goldGradient(ctx, -cs, -cs, cs, cs * 0.7);

  ctx.beginPath();
  ctx.moveTo(-cs * 0.92, cs * 0.34);
  ctx.quadraticCurveTo(-cs * 1.08, -cs * 0.15, -cs * 1.1, -cs * 0.52);
  ctx.quadraticCurveTo(-cs * 0.75, -cs * 0.08, -cs * 0.56, -cs * 0.14);
  ctx.quadraticCurveTo(-cs * 0.52, -cs * 0.48, -cs * 0.48, -cs * 0.68);
  ctx.quadraticCurveTo(-cs * 0.24, -cs * 0.12, -cs * 0.16, -cs * 0.18);
  ctx.quadraticCurveTo(0, -cs * 0.65, 0, -cs * 0.86);
  ctx.quadraticCurveTo(0, -cs * 0.65, cs * 0.16, -cs * 0.18);
  ctx.quadraticCurveTo(cs * 0.24, -cs * 0.12, cs * 0.48, -cs * 0.68);
  ctx.quadraticCurveTo(cs * 0.52, -cs * 0.48, cs * 0.56, -cs * 0.14);
  ctx.quadraticCurveTo(cs * 0.75, -cs * 0.08, cs * 1.1, -cs * 0.52);
  ctx.quadraticCurveTo(cs * 1.08, -cs * 0.15, cs * 0.92, cs * 0.34);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.2, cs * 0.03);
  ctx.strokeStyle = "#78350f";
  ctx.stroke();

  // Specular band sweeping across the metal, clipped to the silhouette.
  ctx.save();
  ctx.clip();
  const phase = ((elapsedMs * 0.0009) % 2) - 0.45;
  const sx = (phase - 0.5) * cs * 3.4;
  const sheen = ctx.createLinearGradient(sx - cs * 0.45, -cs, sx + cs * 0.45, cs);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.85)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-cs * 1.4, -cs, cs * 2.8, cs * 1.8);
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(-cs * 0.95, cs * 0.32, cs * 1.9, cs * 0.3, cs * 0.08);
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = "#78350f";
  ctx.stroke();

  const pearls: Array<[number, number, number]> = [
    [-cs * 1.1, -cs * 0.54, cs * 0.09],
    [-cs * 0.48, -cs * 0.71, cs * 0.1],
    [0, -cs * 0.9, cs * 0.125],
    [cs * 0.48, -cs * 0.71, cs * 0.1],
    [cs * 1.1, -cs * 0.54, cs * 0.09],
  ];
  for (const [ox, oy, r] of pearls) {
    const pg = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.3, 0, ox, oy, r);
    pg.addColorStop(0, "#ffffff");
    pg.addColorStop(1, "#fcd34d");
    ctx.beginPath();
    ctx.arc(ox, oy, r, 0, Math.PI * 2);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.stroke();
  }
  for (const px of [-cs * 0.55, cs * 0.55]) {
    ctx.beginPath();
    ctx.arc(px, cs * 0.47, cs * 0.075, 0, Math.PI * 2);
    ctx.fillStyle = "#dc2626";
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, cs * 0.35);
  ctx.lineTo(cs * 0.13, cs * 0.47);
  ctx.lineTo(0, cs * 0.59);
  ctx.lineTo(-cs * 0.13, cs * 0.47);
  ctx.closePath();
  ctx.fillStyle = "#38bdf8";
  ctx.fill();
  ctx.strokeStyle = "#0369a1";
  ctx.stroke();
  ctx.restore();
}

function drawLaurel(ctx: CanvasRenderingContext2D, radius: number, grow: number) {
  const count = 9;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < count; i += 1) {
      const u = i / (count - 1);
      if (u > grow) break;
      // Arc from the bottom of the wreath up each side.
      const a = Math.PI * (0.5 - u * 0.78);
      const x = side * Math.cos(a) * radius;
      const y = Math.sin(a) * radius * 0.82 - radius * 0.12;
      const s = radius * (0.2 - u * 0.05);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-0.82 * Math.cos(a), side * Math.sin(a)) - side * 0.4);
      const g = ctx.createLinearGradient(-s, 0, s, 0);
      g.addColorStop(0, "#b45309");
      g.addColorStop(0.5, "#fde047");
      g.addColorStop(1, "#d97706");
      ctx.fillStyle = g;
      ctx.strokeStyle = "rgba(120, 53, 15, 0.85)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s * 0.62, s, 0);
      ctx.quadraticCurveTo(0, s * 0.62, -s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Art-deco quarter fan (concentric arcs, radial spokes, scalloped rim) drawn into one corner. */
function artDecoFan(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  R: number,
  sx: 1 | -1,
  sy: 1 | -1,
  p: number,
) {
  if (p <= 0.01) return;
  const sweep = p * (Math.PI / 2);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(sx, sy);

  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  wash.addColorStop(0, "rgba(251, 191, 36, 0.3)");
  wash.addColorStop(1, "rgba(251, 191, 36, 0)");
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, R, 0, sweep);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = goldGradient(ctx, 0, 0, R, R);
  ctx.lineWidth = 1.3;
  const spokes = 10;
  for (let i = 0; i <= spokes; i += 1) {
    const a = (i / spokes) * (Math.PI / 2);
    if (a > sweep) break;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2);
    ctx.lineTo(Math.cos(a) * R * 0.96, Math.sin(a) * R * 0.96);
    ctx.stroke();
  }
  for (let k = 0; k < 4; k += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, R * (0.28 + k * 0.22), 0, sweep);
    ctx.stroke();
  }
  const scallops = 8;
  const rr = R * 0.96;
  ctx.lineWidth = 1.6;
  for (let j = 0; j < scallops; j += 1) {
    const a0 = (j / scallops) * (Math.PI / 2);
    const a1 = ((j + 1) / scallops) * (Math.PI / 2);
    if (a1 > sweep) break;
    const mid = (a0 + a1) / 2;
    const sr = rr * Math.sin((a1 - a0) / 2);
    ctx.beginPath();
    ctx.arc(Math.cos(mid) * rr, Math.sin(mid) * rr, sr, mid - Math.PI / 2, mid + Math.PI / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function createAdminRenderer(initW: number, initH: number): FrameRenderer {
  interface Glitter {
    x: number;
    y: number;
    vy: number;
    size: number;
    ph: number;
    sp: number;
  }
  const initM = Math.min(initW, initH);
  const glitter: Glitter[] = Array.from({ length: 70 }, () => ({
    x: Math.random() * initW,
    y: Math.random() * initH,
    vy: 0.12 + Math.random() * 0.34,
    size: initM * (0.004 + Math.random() * 0.007) + 1,
    ph: Math.random() * Math.PI * 2,
    sp: 0.004 + Math.random() * 0.008,
  }));
  let lastMs = 0;

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const cx = w * 0.5;
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Art-deco fans unfold from all four corners.
    const fanP = easeOutCubic(clamp01((t - 0.02) / 0.42));
    ctx.save();
    ctx.globalAlpha = env;
    const R = m * 0.55;
    artDecoFan(ctx, 0, 0, R, 1, 1, fanP);
    artDecoFan(ctx, w, 0, R, -1, 1, fanP);
    artDecoFan(ctx, 0, h, R, 1, -1, fanP);
    artDecoFan(ctx, w, h, R, -1, -1, fanP);
    ctx.restore();

    // 2. Crest: crown arrives large in the centre, then glides up to become the page emblem.
    const arrive = easeOutBack(clamp01(t / 0.22));
    const glide = easeOutCubic(clamp01((t - 0.28) / 0.3));
    const crestY = lerp(h * 0.46, h * 0.2, glide);
    const crestS = lerp(m * 0.17, m * 0.08, glide) * arrive;
    const floatY = Math.sin(elapsedMs * 0.0032) * m * 0.006;
    if (crestS > 1) {
      ctx.save();
      ctx.translate(cx, crestY + floatY);
      ctx.globalAlpha = smooth(t / 0.1) * (1 - smooth((t - 0.8) / 0.2));
      drawGlow(ctx, 0, 0, crestS * 3.2, "251, 191, 36", 0.4);
      ctx.save();
      ctx.rotate(elapsedMs * 0.00018);
      for (let i = 0; i < 20; i += 1) {
        const a = (i / 20) * Math.PI * 2;
        const long = i % 2 === 0;
        ctx.fillStyle = `rgba(217, 119, 6, ${long ? 0.3 : 0.16})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, crestS * (long ? 3 : 2.1), a - 0.045, a + 0.045);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // thin double halo
      ctx.strokeStyle = goldGradient(ctx, -crestS * 2, -crestS * 2, crestS * 2, crestS * 2);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, crestS * 2.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, crestS * 2.2, 0, Math.PI * 2);
      ctx.stroke();
      drawLaurel(ctx, crestS * 1.65, easeOutCubic(clamp01((t - 0.12) / 0.3)));
      drawCrown(ctx, crestS, elapsedMs);
      ctx.restore();
    }

    // 3. Fine gold dust drifting down (twinkling, outlined so it reads on white).
    for (const g of glitter) {
      g.y += g.vy * dt;
      g.x += Math.sin(elapsedMs * 0.0015 + g.ph) * 0.25 * dt;
      if (g.y > h + 8) {
        g.y = -8;
        g.x = Math.random() * w;
      }
      const tw = 0.25 + 0.75 * Math.abs(Math.sin(elapsedMs * g.sp + g.ph));
      drawSparkle(ctx, g.x, g.y, g.size * 0.7, tw > 0.7 ? "#fff7c2" : "#fbbf24", "#b45309", tw * env * 0.95);
    }

    // 4. One diagonal gleam sweeps across the whole scene (like light over a gold plate).
    const sweep = clamp01((t - 0.42) / 0.3);
    if (sweep > 0 && sweep < 1) {
      ctx.save();
      ctx.translate(lerp(-w * 0.2, w * 1.2, easeOutCubic(sweep)), h / 2);
      ctx.rotate(-0.45);
      const bw = w * 0.1;
      const gl = ctx.createLinearGradient(-bw, 0, bw, 0);
      gl.addColorStop(0, "rgba(255, 236, 150, 0)");
      gl.addColorStop(0.5, `rgba(255, 224, 120, ${0.5 * env})`);
      gl.addColorStop(1, "rgba(255, 236, 150, 0)");
      ctx.fillStyle = gl;
      ctx.fillRect(-bw, -h, bw * 2, h * 2);
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Aurora                                                              */
/* ------------------------------------------------------------------ */

function createAuroraRenderer(initW: number, initH: number): FrameRenderer {
  interface Star {
    x: number;
    y: number;
    size: number;
    phase: number;
    speed: number;
    cross: boolean;
    color: string;
  }

  interface Meteor {
    startMs: number;
    durationMs: number;
    sx: number;
    sy: number;
    dx: number;
    dy: number;
  }

  const starColors = ["#6366f1", "#0ea5e9", "#8b5cf6", "#14b8a6"];
  const stars: Star[] = Array.from({ length: 70 }, () => ({
    x: Math.random() * initW,
    y: Math.random() * initH * 0.8,
    size: 0.8 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
    speed: 0.003 + Math.random() * 0.005,
    cross: Math.random() > 0.78,
    color: starColors[Math.floor(Math.random() * starColors.length)]!,
  }));

  const meteors: Meteor[] = Array.from({ length: 5 }, (_, i) => ({
    startMs: 450 + i * 620,
    durationMs: 760,
    sx: initW * (0.35 + Math.random() * 0.6),
    sy: initH * (0.03 + Math.random() * 0.25),
    dx: -(initW * (0.22 + Math.random() * 0.14)),
    dy: initH * (0.2 + Math.random() * 0.14),
  }));

  // rgb triplets; saturated enough to read on white, luminous on dark.
  const layers = [
    { base: 0.3, amp: 0.07, freq: 1.3, speed: 0.0011, hgt: 0.34, phase: 0, c: ["16, 185, 129", "6, 182, 212", "59, 130, 246"], a: 0.46 },
    { base: 0.36, amp: 0.08, freq: 1.8, speed: -0.0009, hgt: 0.36, phase: 1.7, c: ["20, 184, 166", "59, 130, 246", "139, 92, 246"], a: 0.4 },
    { base: 0.42, amp: 0.06, freq: 2.4, speed: 0.0014, hgt: 0.3, phase: 3.1, c: ["99, 102, 241", "139, 92, 246", "217, 70, 239"], a: 0.34 },
    { base: 0.24, amp: 0.05, freq: 2.9, speed: -0.0012, hgt: 0.26, phase: 4.4, c: ["236, 72, 153", "168, 85, 247", "59, 130, 246"], a: 0.28 },
  ];

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Twinkling starfield (coloured cores + glow so they survive a white page).
    for (const s of stars) {
      const tw = 0.25 + 0.75 * Math.abs(Math.sin(elapsedMs * s.speed + s.phase));
      const a = tw * env;
      if (s.cross) {
        drawSparkle(ctx, s.x, s.y, s.size * 1.1, s.color, null, a * 0.9);
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        drawGlow(ctx, s.x, s.y, s.size * 3.2, "99, 102, 241", 0.22);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 2. Silk curtains: filled ribbon + thin vertical rays sharing one vertical gradient.
    const seg = 36;
    const rayStep = Math.max(6, Math.round(w / 60));
    for (const L of layers) {
      const yAt = (x: number) => {
        const u = x / w;
        return (
          h *
          (L.base +
            Math.sin(u * L.freq * Math.PI * 2 + elapsedMs * L.speed + L.phase) * L.amp +
            Math.sin(u * L.freq * 2.3 * Math.PI * 2 - elapsedMs * L.speed * 1.4 + L.phase) *
              L.amp *
              0.45)
        );
      };
      const bandH = h * L.hgt * (0.55 + 0.45 * smooth(t / 0.3));
      const top = h * (L.base - L.amp * 1.6);
      const bottom = h * (L.base + L.amp * 1.6) + bandH;
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, `rgba(${L.c[0]}, 0)`);
      g.addColorStop(0.4, `rgba(${L.c[0]}, ${L.a * 0.55})`);
      g.addColorStop(0.72, `rgba(${L.c[1]}, ${L.a})`);
      g.addColorStop(0.9, `rgba(${L.c[2]}, ${L.a * 0.5})`);
      g.addColorStop(1, `rgba(${L.c[2]}, 0)`);

      ctx.save();
      ctx.globalAlpha = env;
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i <= seg; i += 1) {
        const x = (i / seg) * w;
        const y = yAt(x);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = seg; i >= 0; i -= 1) {
        const x = (i / seg) * w;
        ctx.lineTo(x, yAt(x) + bandH * (0.8 + 0.2 * Math.sin(x * 0.02 + elapsedMs * 0.002 + L.phase)));
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = g;
      ctx.lineCap = "round";
      for (let x = 0; x <= w; x += rayStep) {
        const flick = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.03 + elapsedMs * 0.0016 + L.phase));
        const y0 = yAt(x);
        ctx.globalAlpha = env * flick * 0.55;
        ctx.lineWidth = Math.max(1, rayStep * 0.35);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + bandH * (0.55 + 0.4 * flick));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Shooting stars with long luminous tails.
    for (const mt of meteors) {
      const p = (elapsedMs - mt.startMs) / mt.durationMs;
      if (p < 0 || p > 1) continue;
      const hx = mt.sx + mt.dx * p;
      const hy = mt.sy + mt.dy * p;
      const tp = Math.max(0, p - 0.3);
      const tx = mt.sx + mt.dx * tp;
      const ty = mt.sy + mt.dy * tp;
      const fade = Math.sin(p * Math.PI) * env;

      ctx.save();
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, "rgba(99, 102, 241, 0)");
      g.addColorStop(0.7, `rgba(14, 165, 233, ${0.7 * fade})`);
      g.addColorStop(1, `rgba(255, 255, 255, ${fade})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(56, 189, 248, 0.9)";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      drawGlow(ctx, hx, hy, 9, "56, 189, 248", 0.55 * fade);
      drawSparkle(ctx, hx, hy, 2.4, "#ffffff", "#0ea5e9", fade);
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Sakura                                                              */
/* ------------------------------------------------------------------ */

function petalPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(-s * 0.95, s * 0.25, -s * 0.62, -s * 0.92, -s * 0.14, -s * 0.82);
  ctx.lineTo(0, -s * 0.56);
  ctx.lineTo(s * 0.14, -s * 0.82);
  ctx.bezierCurveTo(s * 0.62, -s * 0.92, s * 0.95, s * 0.25, 0, s);
  ctx.closePath();
}

function fillPetal(ctx: CanvasRenderingContext2D, s: number, back: boolean) {
  const g = ctx.createLinearGradient(0, s, 0, -s);
  if (back) {
    g.addColorStop(0, "#f472b6");
    g.addColorStop(1, "#db2777");
  } else {
    g.addColorStop(0, "#fff1f2");
    g.addColorStop(0.45, "#f9a8d4");
    g.addColorStop(1, "#ec4899");
  }
  petalPath(ctx, s);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(190, 24, 93, 0.5)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

function drawBlossom(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  for (let i = 0; i < 5; i += 1) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2);
    ctx.translate(0, -s * 0.95);
    fillPetal(ctx, s, false);
    ctx.restore();
  }
  ctx.fillStyle = "#fde047";
  ctx.strokeStyle = "#b45309";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#be185d";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function createSakuraRenderer(initW: number, initH: number): FrameRenderer {
  interface Petal {
    x: number;
    y: number;
    vy: number;
    drift: number;
    size: number;
    rot: number;
    spin: number;
    flip: number;
    flipSpeed: number;
    blossom: boolean;
    phase: number;
  }

  const initM = Math.min(initW, initH);
  const petals: Petal[] = Array.from({ length: 64 }, () => {
    const blossom = Math.random() > 0.86;
    return {
      x: initW * (-0.15 + Math.random() * 1.1),
      y: -initH * Math.random() * 0.7 - 10,
      vy: 0.0035 + Math.random() * 0.004,
      drift: 0.3 + Math.random() * 0.7,
      size: initM * (blossom ? 0.016 + Math.random() * 0.008 : 0.011 + Math.random() * 0.01) + 1.5,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.05,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 0.003 + Math.random() * 0.004,
      blossom,
      phase: Math.random() * Math.PI * 2,
    };
  });

  // Branches reaching in from the two top corners, with blossoms along them (normalised).
  const branches = [
    { from: [0, 0.02], c1: [0.1, 0.06], c2: [0.16, 0.16], to: [0.26, 0.12], blooms: [0.35, 0.62, 0.9] },
    { from: [0.03, 0], c1: [0.06, 0.14], c2: [0.05, 0.2], to: [0.1, 0.3], blooms: [0.55, 0.95] },
    { from: [1, 0.04], c1: [0.9, 0.08], c2: [0.85, 0.18], to: [0.74, 0.15], blooms: [0.4, 0.7, 0.95] },
  ] as const;
  const bez = (a: number, b: number, c: number, d: number, u: number) =>
    (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;

  let lastMs = 0;

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Corner branches grow in, then blossoms pop open along them.
    const grow = easeOutCubic(clamp01(t / 0.32));
    for (const b of branches) {
      const steps = 24;
      const end = Math.max(1, Math.round(steps * grow));
      const P = (u: number): [number, number] => [
        bez(b.from[0], b.c1[0], b.c2[0], b.to[0], u) * w,
        bez(b.from[1], b.c1[1], b.c2[1], b.to[1], u) * h,
      ];
      ctx.save();
      ctx.globalAlpha = env;
      ctx.lineCap = "round";
      for (let s = 0; s < end; s += 1) {
        const [x0, y0] = P(s / steps);
        const [x1, y1] = P((s + 1) / steps);
        ctx.strokeStyle = "#5b3a29";
        ctx.lineWidth = Math.max(1, m * 0.014 * (1 - s / steps) + 1);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      b.blooms.forEach((u, i) => {
        const pop = clamp01((grow - u) / 0.12 + (grow >= 1 ? 1 : 0));
        if (pop <= 0) return;
        const [x, y] = P(u);
        const sway = Math.sin(elapsedMs * 0.002 + i) * 0.08;
        drawBlossom(ctx, x, y, m * 0.022 * easeOutBack(Math.min(1, pop)), sway + i);
      });
      ctx.restore();
    }

    // 2. Falling petals and whole blossoms, swaying on a gusting breeze.
    const gust = 0.0016 + Math.sin(elapsedMs * 0.0011) * 0.0011;
    for (const p of petals) {
      p.y += p.vy * h * dt;
      p.x += (gust * w * p.drift + Math.sin(elapsedMs * 0.0024 + p.phase) * 0.6) * dt;
      p.rot += p.spin * dt;
      if (p.y > h + 20 || p.x > w + 30) {
        p.y = -20 - Math.random() * h * 0.2;
        p.x = w * (-0.15 + Math.random() * 0.9);
      }
      if (p.y < -20) continue;
      const f = Math.cos(elapsedMs * p.flipSpeed + p.flip);
      ctx.save();
      ctx.globalAlpha = 0.95 * env;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.blossom) {
        ctx.scale(1, Math.max(0.3, Math.abs(f)));
        drawBlossom(ctx, 0, 0, p.size * 0.6, 0);
      } else {
        ctx.scale(Math.max(0.15, Math.abs(f)), 1);
        fillPetal(ctx, p.size, f < 0);
      }
      ctx.restore();
    }

    // 3. Soft pink light motes.
    for (let i = 0; i < 14; i += 1) {
      const x = hash(i * 3.1) * w;
      const y = (hash(i * 7.7) * h + elapsedMs * 0.012 * (0.5 + hash(i))) % h;
      const a = (0.35 + 0.35 * Math.sin(elapsedMs * 0.004 + i)) * env;
      drawSparkle(ctx, x, h - y, 1.8, "#f9a8d4", "#db2777", a);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Fireworks                                                           */
/* ------------------------------------------------------------------ */

type BurstKind = "peony" | "willow" | "ring" | "heart";

function createFireworksRenderer(_initW: number, _initH: number): FrameRenderer {
  interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    decay: number;
    color: string;
    rgb: string;
    trail: Array<[number, number]>;
    tl: number;
    grav: number;
    crackle: boolean;
  }
  interface Shell {
    at: number;
    tx: number;
    ty: number;
    pal: number;
    kind: BurstKind;
    exploded: boolean;
  }

  const palettes: Array<[string, string, string]> = [
    ["#ef4444", "#fca5a5", "239, 68, 68"],
    ["#f59e0b", "#fef08a", "245, 158, 11"],
    ["#10b981", "#a7f3d0", "16, 185, 129"],
    ["#3b82f6", "#bfdbfe", "59, 130, 246"],
    ["#a855f7", "#e9d5ff", "168, 85, 247"],
    ["#ec4899", "#fbcfe8", "236, 72, 153"],
  ];
  const RISE_MS = 520;
  const plan: Array<[number, number, number, BurstKind]> = [
    [150, 0.22, 0.3, "peony"],
    [480, 0.78, 0.26, "ring"],
    [850, 0.5, 0.2, "heart"],
    [1250, 0.14, 0.22, "willow"],
    [1450, 0.86, 0.34, "peony"],
    [1850, 0.36, 0.24, "ring"],
    [2150, 0.64, 0.16, "willow"],
    [2450, 0.5, 0.3, "peony"],
    [2650, 0.2, 0.36, "heart"],
    [2700, 0.8, 0.16, "peony"],
  ];
  const shells: Shell[] = plan.map(([at, tx, ty, kind], i) => ({
    at,
    tx,
    ty,
    kind,
    pal: kind === "willow" ? 1 : (i * 5 + 2) % palettes.length,
    exploded: false,
  }));
  const sparks: Spark[] = [];
  const flashes: Array<{ x: number; y: number; at: number; rgb: string }> = [];

  // Skyline (normalised) so the show has something to stand behind.
  const buildings: Array<{ x: number; w: number; h: number }> = [];
  {
    let x = 0;
    while (x < 1) {
      const bw = 0.04 + Math.random() * 0.05;
      buildings.push({ x, w: Math.min(bw, 1 - x), h: 0.05 + Math.random() * 0.1 });
      x += bw;
    }
  }
  let lastMs = 0;

  const burst = (s: Shell, w: number, h: number, now: number) => {
    const m = Math.min(w, h);
    const pal = palettes[s.pal]!;
    const x = s.tx * w;
    const y = s.ty * h;
    const add = (vx: number, vy: number, o: Partial<Spark> & { color?: string }) =>
      sparks.push({
        x,
        y,
        vx,
        vy,
        life: 1,
        decay: 0.011,
        color: pal[0],
        rgb: pal[2],
        trail: [],
        tl: 7,
        grav: 0.00014,
        crackle: false,
        ...o,
      });
    if (s.kind === "peony") {
      for (let i = 0; i < 96; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = m * (0.0105 + Math.random() * 0.004);
        add(Math.cos(a) * sp, Math.sin(a) * sp, {
          color: i % 4 === 0 ? pal[1] : pal[0],
          decay: 0.009 + Math.random() * 0.006,
          crackle: Math.random() > 0.72,
        });
      }
    } else if (s.kind === "willow") {
      for (let i = 0; i < 80; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = m * (0.006 + Math.random() * 0.005);
        add(Math.cos(a) * sp, Math.sin(a) * sp, {
          color: "#fbbf24",
          rgb: "245, 158, 11",
          decay: 0.0055 + Math.random() * 0.003,
          grav: 0.00032,
          tl: 15,
        });
      }
    } else if (s.kind === "ring") {
      for (let i = 0; i < 64; i += 1) {
        const a = (i / 64) * Math.PI * 2;
        add(Math.cos(a) * m * 0.0125, Math.sin(a) * m * 0.0125, { decay: 0.01, tl: 8 });
      }
      const alt = palettes[(s.pal + 2) % palettes.length]!;
      for (let i = 0; i < 32; i += 1) {
        const a = (i / 32) * Math.PI * 2 + 0.1;
        add(Math.cos(a) * m * 0.0072, Math.sin(a) * m * 0.0072, {
          color: alt[0],
          rgb: alt[2],
          decay: 0.012,
        });
      }
    } else {
      for (let i = 0; i < 78; i += 1) {
        const a = (i / 78) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(a), 3);
        const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        add(hx * m * 0.00082, hy * m * 0.00082, { color: "#f43f5e", rgb: "244, 63, 94", decay: 0.0095, grav: 0.00009 });
      }
    }
    flashes.push({ x, y, at: now, rgb: pal[2] });
  };

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const env = envelope(t);
    const rise = easeOutCubic(clamp01(t / 0.2));

    ctx.clearRect(0, 0, w, h);

    // 1. City skyline silhouette with softly blinking windows.
    ctx.save();
    ctx.globalAlpha = env * rise;
    for (const b of buildings) {
      const bx = b.x * w;
      const bw = b.w * w;
      const bh = b.h * h * rise;
      ctx.fillStyle = "#1e1b4b";
      ctx.fillRect(bx, h - bh, bw + 0.5, bh);
      ctx.fillStyle = "#fde047";
      const cell = Math.max(6, m * 0.026);
      for (let wy = h - bh + cell * 0.6; wy < h - cell * 0.5; wy += cell) {
        for (let wx = bx + cell * 0.45; wx < bx + bw - cell * 0.7; wx += cell) {
          if (hash(wx * 0.37 + wy * 1.3 + Math.floor(elapsedMs / 700)) > 0.62) {
            ctx.fillRect(wx, wy, cell * 0.32, cell * 0.38);
          }
        }
      }
    }
    ctx.restore();

    // 2. Rockets: glowing head, spark exhaust, then burst.
    for (const s of shells) {
      const k = (elapsedMs - s.at) / RISE_MS;
      if (k < 0) continue;
      const pal = palettes[s.pal]!;
      const tx = s.tx * w;
      const ty = s.ty * h;
      if (k < 1) {
        const e = easeOutCubic(k);
        const x = tx + Math.sin(k * 11) * 1.5;
        const y = lerp(h - 4, ty, e);
        const g = ctx.createLinearGradient(x, y, x, y + m * 0.16);
        g.addColorStop(0, `rgba(${pal[2]}, 0.95)`);
        g.addColorStop(1, `rgba(${pal[2]}, 0)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + m * 0.16);
        ctx.stroke();
        for (let i = 0; i < 3; i += 1) {
          const sy = y + m * (0.02 + hash(i + Math.floor(elapsedMs / 50) + s.at) * 0.12);
          drawGlow(ctx, x + (hash(i * 7 + s.at + Math.floor(elapsedMs / 50)) - 0.5) * 6, sy, 3, pal[2], 0.7 * env);
        }
        drawGlow(ctx, x, y, 9, pal[2], 0.75 * env);
        ctx.fillStyle = "#fffbeb";
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      } else if (!s.exploded) {
        s.exploded = true;
        burst(s, w, h, elapsedMs);
      }
    }

    // 3. Burst flash + expanding shock ring.
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const f = flashes[i]!;
      const k = (elapsedMs - f.at) / 380;
      if (k > 1) {
        flashes.splice(i, 1);
        continue;
      }
      drawGlow(ctx, f.x, f.y, m * 0.24 * (0.5 + k), f.rgb, 0.45 * (1 - k) * env);
      ctx.strokeStyle = `rgba(${f.rgb}, ${0.55 * (1 - k) * env})`;
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, k * m * 0.18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Sparks: tapered trails, drag, gravity, crackle at the end of life.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const p = sparks[i]!;
      p.trail.push([p.x, p.y]);
      if (p.trail.length > p.tl) p.trail.shift();
      const drag = Math.pow(0.955, dt);
      p.vx *= drag;
      p.vy = p.vy * drag + m * p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      let a = clamp01(p.life * 1.4) * (0.3 + 0.7 * env);
      if (p.crackle && p.life < 0.4) a *= hash(Math.floor(elapsedMs / 45) + i) > 0.45 ? 1 : 0.1;
      ctx.globalAlpha = a * 0.6;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      p.trail.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = `rgb(${p.rgb})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (p.life > 0.7) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
}

/* ------------------------------------------------------------------ */
/* Ocean                                                               */
/* ------------------------------------------------------------------ */

function createOceanRenderer(initW: number, initH: number): FrameRenderer {
  interface Bubble {
    x: number;
    y: number;
    r: number;
    speed: number;
    wobble: number;
    phase: number;
    popAt: number;
    popMs: number;
  }

  const initM = Math.min(initW, initH);
  const newBubble = (w: number, h: number, scatter: boolean): Bubble => ({
    x: w * (0.03 + Math.random() * 0.94),
    y: scatter ? h * (0.85 + Math.random() * 0.4) : h + 10,
    r: initM * (0.007 + Math.random() * 0.018) + 1,
    speed: 0.0028 + Math.random() * 0.004,
    wobble: 2 + Math.random() * 5,
    phase: Math.random() * Math.PI * 2,
    popAt: h * (0.08 + Math.random() * 0.5),
    popMs: -1,
  });
  const bubbles: Bubble[] = Array.from({ length: 42 }, () => newBubble(initW, initH, true));
  const waves = [
    { amp: 0.018, len: 1.4, speed: 0.0012, rise: 0.2, top: "56, 189, 248", bot: "3, 105, 161", a: 0.35 },
    { amp: 0.022, len: 1.9, speed: -0.0016, rise: 0.15, top: "45, 212, 191", bot: "15, 118, 110", a: 0.4 },
    { amp: 0.016, len: 2.6, speed: 0.0021, rise: 0.1, top: "14, 165, 233", bot: "7, 89, 133", a: 0.55 },
  ];
  let lastMs = 0;

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Sunlight shafts slanting down from the surface.
    for (let i = 0; i < 5; i += 1) {
      const sway = Math.sin(elapsedMs * 0.0009 + i * 1.3) * w * 0.03;
      const x = w * (0.1 + i * 0.2) + sway;
      const bw = w * (0.05 + hash(i) * 0.05);
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.85);
      g.addColorStop(0, `rgba(56, 189, 248, ${0.22 * env})`);
      g.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.5, 0);
      ctx.lineTo(x + bw * 0.5, 0);
      ctx.lineTo(x + bw * 1.4 + w * 0.08, h * 0.85);
      ctx.lineTo(x - bw * 0.2 + w * 0.08, h * 0.85);
      ctx.closePath();
      ctx.fill();
    }

    // 2. Bubbles rising and wobbling, popping into a small ring.
    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i]!;
      if (b.popMs >= 0) {
        const k = (elapsedMs - b.popMs) / 260;
        if (k >= 1) {
          bubbles[i] = newBubble(w, h, false);
          continue;
        }
        ctx.strokeStyle = `rgba(2, 132, 199, ${0.7 * (1 - k) * env})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * (1 + k * 1.2), 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      b.y -= b.speed * h * dt;
      const x = b.x + Math.sin(elapsedMs * 0.003 + b.phase) * b.wobble;
      if (b.y < b.popAt && t < 0.85) {
        b.x = x;
        b.popMs = elapsedMs;
        continue;
      }
      const g = ctx.createRadialGradient(x - b.r * 0.3, b.y - b.r * 0.3, 0, x, b.y, b.r);
      g.addColorStop(0, `rgba(224, 242, 254, ${0.2 * env})`);
      g.addColorStop(0.8, `rgba(125, 211, 252, ${0.18 * env})`);
      g.addColorStop(1, `rgba(14, 165, 233, ${0.35 * env})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(2, 132, 199, ${0.75 * env})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * env})`;
      ctx.lineWidth = Math.max(1, b.r * 0.18);
      ctx.beginPath();
      ctx.arc(x, b.y, b.r * 0.62, Math.PI * 1.1, Math.PI * 1.45);
      ctx.stroke();
    }

    // 3. Layered waves rising at the bottom edge with a foam crest.
    const rise = easeOutCubic(clamp01(t / 0.3));
    const seg = 40;
    for (const wv of waves) {
      const base = h - h * wv.rise * rise * env;
      const yAt = (x: number) =>
        base +
        Math.sin((x / w) * wv.len * Math.PI * 2 + elapsedMs * wv.speed) * h * wv.amp +
        Math.sin((x / w) * wv.len * 3.1 * Math.PI * 2 - elapsedMs * wv.speed * 1.7) * h * wv.amp * 0.35;
      const g = ctx.createLinearGradient(0, base - h * wv.amp * 2, 0, h);
      g.addColorStop(0, `rgba(${wv.top}, ${wv.a * env})`);
      g.addColorStop(1, `rgba(${wv.bot}, ${wv.a * 1.2 * env})`);
      ctx.beginPath();
      for (let i = 0; i <= seg; i += 1) {
        const x = (i / seg) * w;
        if (i === 0) ctx.moveTo(x, yAt(x));
        else ctx.lineTo(x, yAt(x));
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= seg; i += 1) {
        const x = (i / seg) * w;
        if (i === 0) ctx.moveTo(x, yAt(x));
        else ctx.lineTo(x, yAt(x));
      }
      ctx.strokeStyle = `rgba(3, 105, 161, ${0.55 * env})`;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(240, 249, 255, ${0.85 * env})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Neon                                                                */
/* ------------------------------------------------------------------ */

function createNeonRenderer(initW: number, initH: number): FrameRenderer {
  interface Shape {
    x: number;
    y: number;
    size: number;
    rot: number;
    spin: number;
    vy: number;
    kind: 0 | 1 | 2;
    color: string;
  }
  const colors = ["#d946ef", "#06b6d4", "#f59e0b", "#ec4899"];
  const initM = Math.min(initW, initH);
  const shapes: Shape[] = Array.from({ length: 12 }, (_, i) => {
    const left = i % 2 === 0;
    return {
      x: initW * (left ? 0.04 + Math.random() * 0.16 : 0.8 + Math.random() * 0.16),
      y: initH * (0.1 + Math.random() * 0.55),
      size: initM * (0.018 + Math.random() * 0.02),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.03,
      vy: -(0.15 + Math.random() * 0.3),
      kind: (i % 3) as 0 | 1 | 2,
      color: colors[i % colors.length]!,
    };
  });
  let lastMs = 0;

  const framePath = (ctx: CanvasRenderingContext2D, w: number, h: number, p: number, r: number) => {
    // Clockwise from the top centre, so a mirrored copy grows the other way.
    ctx.beginPath();
    ctx.moveTo(w / 2, p);
    ctx.arcTo(w - p, p, w - p, h - p, r);
    ctx.arcTo(w - p, h - p, p, h - p, r);
    ctx.arcTo(p, h - p, p, p, r);
    ctx.arcTo(p, p, w / 2, p, r);
    ctx.closePath();
  };

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const env = envelope(t);
    // Neon ignition flicker during the opening.
    const flicker = t < 0.2 ? (hash(Math.floor(elapsedMs / 50)) > 0.3 ? 1 : 0.35) : 1;
    const a = env * flicker;

    ctx.clearRect(0, 0, w, h);

    // 1. Synthwave grid floor along the bottom.
    const horizon = h * 0.76;
    const floorIn = easeOutCubic(clamp01(t / 0.3));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, h - horizon);
    ctx.clip();
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, "rgba(217, 70, 239, 0)");
    floor.addColorStop(1, `rgba(217, 70, 239, ${0.14 * a})`);
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.strokeStyle = "#c026d3";
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(217, 70, 239, 0.8)";
    ctx.lineWidth = 1.2;
    const lanes = 14;
    for (let i = -lanes; i <= lanes; i += 1) {
      ctx.globalAlpha = 0.55 * a * floorIn;
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.012, horizon);
      ctx.lineTo(w / 2 + i * w * 0.14, h + 4);
      ctx.stroke();
    }
    const scroll = (elapsedMs * 0.0006) % 1;
    for (let j = 0; j < 9; j += 1) {
      const z = (j + scroll) / 9;
      const y = horizon + (h - horizon) * z * z;
      ctx.globalAlpha = 0.6 * a * floorIn * (0.25 + z * 0.75);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // horizon line, pink → cyan
    const hz = ctx.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, "rgba(6, 182, 212, 0)");
    hz.addColorStop(0.3, "#06b6d4");
    hz.addColorStop(0.5, "#d946ef");
    hz.addColorStop(0.7, "#06b6d4");
    hz.addColorStop(1, "rgba(6, 182, 212, 0)");
    ctx.save();
    ctx.globalAlpha = a * floorIn;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(217, 70, 239, 0.9)";
    ctx.strokeStyle = hz;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
    ctx.restore();

    // 2. Neon tube frame ignites from the top centre and races both ways.
    const pad = Math.max(10, Math.min(22, m * 0.04));
    const radius = Math.max(10, m * 0.04);
    const perim = 2 * (w + h - 4 * pad);
    const grow = easeOutCubic(clamp01((t - 0.04) / 0.36));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = "round";
    for (const mirror of [1, -1]) {
      ctx.save();
      if (mirror === -1) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      framePath(ctx, w, h, pad, radius);
      ctx.setLineDash([(perim / 2) * grow, perim]);
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(217, 70, 239, 0.9)";
      ctx.strokeStyle = "#d946ef";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(6, 182, 212, 0.9)";
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    }
    // Electric comet orbiting the frame once lit.
    if (grow >= 1) {
      framePath(ctx, w, h, pad, radius);
      ctx.setLineDash([perim * 0.07, perim * 0.93]);
      ctx.lineDashOffset = -elapsedMs * perim * 0.00028;
      ctx.shadowBlur = 14;
      ctx.shadowColor = "rgba(34, 211, 238, 1)";
      ctx.strokeStyle = "#0891b2";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#cffafe";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // 3. Floating neon outlines drifting up the side margins.
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const s of shapes) {
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      if (s.y < -s.size * 2) s.y = h * 0.7;
      ctx.save();
      ctx.globalAlpha = 0.85 * a;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.strokeStyle = s.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = s.color;
      ctx.beginPath();
      if (s.kind === 0) {
        ctx.moveTo(0, -s.size);
        ctx.lineTo(s.size * 0.87, s.size * 0.5);
        ctx.lineTo(-s.size * 0.87, s.size * 0.5);
        ctx.closePath();
      } else if (s.kind === 1) {
        ctx.arc(0, 0, s.size * 0.75, 0, Math.PI * 2);
      } else {
        ctx.moveTo(-s.size * 0.7, 0);
        ctx.lineTo(s.size * 0.7, 0);
        ctx.moveTo(0, -s.size * 0.7);
        ctx.lineTo(0, s.size * 0.7);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
}

/* ------------------------------------------------------------------ */
/* Vice City (retro-wave tropical sunset)                              */
/* ------------------------------------------------------------------ */

const PALM_INK = "#2e1065";

function drawPalm(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  height: number,
  lean: 1 | -1,
  elapsedMs: number,
  trunkW: number,
  alpha: number,
) {
  const topX = baseX + lean * height * 0.24;
  const topY = baseY - height;
  const ctrlX = baseX - lean * height * 0.06;
  const ctrlY = baseY - height * 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.strokeStyle = PALM_INK;
  ctx.lineWidth = trunkW;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(ctrlX, ctrlY, topX, topY);
  ctx.stroke();
  // pink rim light on the sunward side of the trunk
  ctx.strokeStyle = "rgba(244, 114, 182, 0.75)";
  ctx.lineWidth = Math.max(1, trunkW * 0.14);
  ctx.beginPath();
  ctx.moveTo(baseX - lean * trunkW * 0.4, baseY);
  ctx.quadraticCurveTo(ctrlX - lean * trunkW * 0.4, ctrlY, topX - lean * trunkW * 0.4, topY);
  ctx.stroke();

  const fronds = 9;
  for (let i = 0; i < fronds; i += 1) {
    const u = i / (fronds - 1);
    const sway = Math.sin(elapsedMs * 0.0019 + i * 0.8 + baseX) * 0.06;
    const a = lerp(-3.0, -0.14, u) + sway;
    const len = height * (0.34 + 0.12 * Math.sin(i * 2.1 + 1));
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tipX = topX + dx * len;
    const tipY = topY + dy * len + len * 0.3;
    const cX = topX + dx * len * 0.55;
    const cY = topY + dy * len * 0.55 - len * 0.2;
    const nx = -dy * len * 0.075;
    const ny = dx * len * 0.075;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(cX + nx, cY + ny, tipX, tipY);
    ctx.quadraticCurveTo(cX - nx, cY - ny, topX, topY);
    ctx.fillStyle = PALM_INK;
    ctx.fill();
    ctx.strokeStyle = "rgba(244, 114, 182, 0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = "#5b21b6";
  ctx.beginPath();
  ctx.arc(topX, topY + 2, trunkW * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRetroCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  L: number,
  alpha: number,
  elapsedMs: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // pink light streak + cyan underglow
  const streak = ctx.createLinearGradient(x - L * 1.8, y, x, y);
  streak.addColorStop(0, "rgba(236, 72, 153, 0)");
  streak.addColorStop(1, "rgba(236, 72, 153, 0.55)");
  ctx.fillStyle = streak;
  ctx.fillRect(x - L * 1.8, y - L * 0.13, L * 1.8, L * 0.035);
  drawGlow(ctx, x + L * 0.5, y + L * 0.02, L * 0.7, "34, 211, 238", 0.45);

  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -L * 0.12);
  ctx.quadraticCurveTo(L * 0.02, -L * 0.17, L * 0.14, -L * 0.19);
  ctx.lineTo(L * 0.3, -L * 0.2);
  ctx.quadraticCurveTo(L * 0.4, -L * 0.34, L * 0.58, -L * 0.34);
  ctx.quadraticCurveTo(L * 0.7, -L * 0.33, L * 0.76, -L * 0.21);
  ctx.quadraticCurveTo(L * 0.95, -L * 0.19, L, -L * 0.1);
  ctx.lineTo(L, 0);
  ctx.closePath();
  ctx.fillStyle = "#1e0b36";
  ctx.fill();
  ctx.strokeStyle = "rgba(244, 114, 182, 0.95)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // window glint
  ctx.beginPath();
  ctx.moveTo(L * 0.4, -L * 0.21);
  ctx.quadraticCurveTo(L * 0.46, -L * 0.3, L * 0.57, -L * 0.3);
  ctx.quadraticCurveTo(L * 0.66, -L * 0.29, L * 0.7, -L * 0.21);
  ctx.closePath();
  ctx.fillStyle = "rgba(34, 211, 238, 0.55)";
  ctx.fill();
  // tail light + headlight
  drawGlow(ctx, L * 0.01, -L * 0.11, L * 0.1, "239, 68, 68", 0.9);
  drawGlow(ctx, L * 0.99, -L * 0.07, L * 0.09, "254, 240, 138", 0.8);
  // wheels
  for (const wx of [0.2, 0.8]) {
    ctx.save();
    ctx.translate(L * wx, 0);
    ctx.fillStyle = "#0f0720";
    ctx.beginPath();
    ctx.arc(0, 0, L * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.rotate(elapsedMs * 0.02);
    ctx.beginPath();
    ctx.moveTo(-L * 0.045, 0);
    ctx.lineTo(L * 0.045, 0);
    ctx.moveTo(0, -L * 0.045);
    ctx.lineTo(0, L * 0.045);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function createViceRenderer(_initW: number, _initH: number): FrameRenderer {
  const stars = Array.from({ length: 24 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.5,
    ph: Math.random() * Math.PI * 2,
    sp: 0.003 + Math.random() * 0.004,
  }));

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const m = Math.min(w, h);
    const env = envelope(t);
    const cx = w * 0.5;
    const horizon = h * 0.7;
    const rise = easeOutCubic(clamp01(t / 0.38));

    ctx.clearRect(0, 0, w, h);

    // 1. Striped sun rising out of the sea (slits are cut out of the disc).
    const R = m * 0.3;
    const sunY = horizon + R * (1 - rise) * 1.05;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, horizon);
    ctx.clip();
    drawGlow(ctx, cx, sunY, R * 1.8, "244, 114, 182", 0.34 * env);
    const sg = ctx.createLinearGradient(0, sunY - R, 0, sunY + R);
    sg.addColorStop(0, "#fde047");
    sg.addColorStop(0.45, "#fb923c");
    sg.addColorStop(0.75, "#ec4899");
    sg.addColorStop(1, "#7c3aed");
    ctx.globalAlpha = 0.72 * env;
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, sunY, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    const step = R * 0.13;
    const scroll = (elapsedMs * 0.012) % step;
    for (let i = 0; i < 7; i += 1) {
      const y = sunY - R * 0.05 + i * step - scroll + step;
      ctx.fillRect(cx - R, y, R * 2, 1.2 + i * R * 0.016);
    }
    ctx.restore();

    // 2. Sea: tinted band, glowing reflection bars and a neon horizon.
    const sea = ctx.createLinearGradient(0, horizon, 0, h);
    sea.addColorStop(0, `rgba(236, 72, 153, ${0.24 * env * rise})`);
    sea.addColorStop(1, `rgba(124, 58, 237, ${0.34 * env * rise})`);
    ctx.fillStyle = sea;
    ctx.fillRect(0, horizon, w, h - horizon);
    const bars = 9;
    for (let i = 0; i < bars; i += 1) {
      const u = i / bars;
      const bw = R * (1.5 - u * 0.95) * (1 + 0.1 * Math.sin(elapsedMs * 0.004 + i * 1.3));
      const by = horizon + 4 + u * (h - horizon - 8);
      ctx.fillStyle = `rgba(${u < 0.4 ? "251, 146, 60" : "236, 72, 153"}, ${0.6 * (1 - u) * env * rise})`;
      ctx.fillRect(cx - bw / 2, by, bw, 1.5 + u * 3);
    }
    const hl = ctx.createLinearGradient(0, 0, w, 0);
    hl.addColorStop(0, "rgba(34, 211, 238, 0)");
    hl.addColorStop(0.25, "#22d3ee");
    hl.addColorStop(0.5, "#f472b6");
    hl.addColorStop(0.75, "#22d3ee");
    hl.addColorStop(1, "rgba(34, 211, 238, 0)");
    ctx.save();
    ctx.globalAlpha = env * rise;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(244, 114, 182, 0.9)";
    ctx.strokeStyle = hl;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
    ctx.restore();

    // 3. Twinkling stars in the upper sky.
    for (const s of stars) {
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(elapsedMs * s.sp + s.ph));
      drawSparkle(ctx, s.x * w, s.y * h, 1.5, "#f9a8d4", "#be185d", tw * env * 0.9);
    }

    // 4. Palms on both margins, swaying; they grow up from the bottom edge.
    const grow = easeOutCubic(clamp01((t - 0.05) / 0.3));
    const tw = Math.max(4, m * 0.024);
    drawPalm(ctx, w * 0.06, h + 4, h * 0.78 * grow, 1, elapsedMs, tw, env);
    drawPalm(ctx, w * 0.14, h + 4, h * 0.5 * grow, 1, elapsedMs + 700, tw * 0.75, env);
    drawPalm(ctx, w * 0.94, h + 4, h * 0.78 * grow, -1, elapsedMs + 300, tw, env);
    drawPalm(ctx, w * 0.86, h + 4, h * 0.46 * grow, -1, elapsedMs + 1100, tw * 0.7, env);

    // 5. Retro coupe cruising along the shoreline with a light streak.
    const L = m * 0.3;
    const drive = smooth((t - 0.1) / 0.78);
    drawRetroCar(ctx, lerp(-L * 1.2, w + L * 0.1, drive), h * 0.93, L, env, elapsedMs);
  };
}

/* ------------------------------------------------------------------ */
/* Storm                                                               */
/* ------------------------------------------------------------------ */

function createStormRenderer(initW: number, initH: number): FrameRenderer {
  interface Drop {
    x: number;
    y: number;
    len: number;
    speed: number;
  }
  interface Bolt {
    at: number;
    xr: number;
    pts: Array<[number, number]>;
    branch: Array<[number, number]>;
  }
  interface Ripple {
    x: number;
    y: number;
    born: number;
  }

  const initM = Math.min(initW, initH);
  const drops: Drop[] = Array.from({ length: 120 }, () => ({
    x: Math.random() * initW * 1.2,
    y: Math.random() * initH,
    len: initM * (0.04 + Math.random() * 0.05),
    speed: 0.016 + Math.random() * 0.012,
  }));
  const bolts: Bolt[] = [
    { at: 650, xr: 0.2, pts: [], branch: [] },
    { at: 1500, xr: 0.8, pts: [], branch: [] },
    { at: 2250, xr: 0.5, pts: [], branch: [] },
    { at: 2950, xr: 0.32, pts: [], branch: [] },
  ];
  const ripples: Ripple[] = [];
  let lastMs = 0;
  let built = false;

  const build = (w: number, h: number) => {
    for (const b of bolts) {
      let x = b.xr * w;
      let y = 0;
      b.pts.push([x, y]);
      while (y < h * 0.6) {
        y += h * (0.05 + Math.random() * 0.06);
        x += (Math.random() - 0.5) * w * 0.09;
        b.pts.push([x, y]);
      }
      const from = b.pts[Math.floor(b.pts.length * 0.4)]!;
      let bx = from[0];
      let by = from[1];
      const dir = Math.random() > 0.5 ? 1 : -1;
      b.branch.push([bx, by]);
      for (let i = 0; i < 3; i += 1) {
        bx += dir * w * (0.03 + Math.random() * 0.04);
        by += h * (0.04 + Math.random() * 0.04);
        b.branch.push([bx, by]);
      }
    }
  };

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const env = envelope(t);
    if (!built) {
      built = true;
      build(w, h);
    }

    ctx.clearRect(0, 0, w, h);

    // 1. Soft storm clouds drifting along the top edge.
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 0.27 + elapsedMs * 0.00004) % 1.3) * w - w * 0.15;
      const r = w * (0.2 + (i % 3) * 0.05);
      const g = ctx.createRadialGradient(x, 0, 0, x, 0, r);
      g.addColorStop(0, `rgba(71, 85, 105, ${0.45 * env})`);
      g.addColorStop(1, "rgba(71, 85, 105, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, 0, r, h * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Rain — denser toward the margins, never a wall over the centre.
    const slant = 0.22;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.3;
    for (const d of drops) {
      d.y += d.speed * h * dt;
      d.x -= d.speed * h * slant * dt;
      if (d.y > h) {
        if (Math.random() > 0.5) ripples.push({ x: d.x, y: h - Math.random() * h * 0.08, born: elapsedMs });
        d.y = -d.len;
        d.x = Math.random() * w * 1.2;
      }
      const edge = Math.abs(d.x / w - 0.5) * 2;
      const a = (0.2 + 0.4 * Math.min(1, edge)) * env;
      ctx.strokeStyle = `rgba(37, 99, 235, ${a})`;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * slant, d.y - d.len);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Puddle ripples.
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const r = ripples[i]!;
      const k = (elapsedMs - r.born) / 500;
      if (k >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(30, 64, 175, ${0.55 * (1 - k) * env})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 3 + k * m * 0.04, 1 + k * m * 0.012, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Lightning: violet halo, white-hot core, flicker and a sky flash.
    for (const b of bolts) {
      const k = (elapsedMs - b.at) / 420;
      if (k < 0 || k > 1) continue;
      const flick = k < 0.18 ? 1 : (hash(Math.floor(elapsedMs / 40) + b.at) > 0.45 ? 0.85 : 0.3) * (1 - k);
      const flash = ctx.createRadialGradient(b.pts[0]![0], 0, 0, b.pts[0]![0], 0, h * 1.0);
      flash.addColorStop(0, `rgba(196, 181, 253, ${0.32 * flick * env})`);
      flash.addColorStop(1, "rgba(196, 181, 253, 0)");
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, w, h);
      for (const path of [b.pts, b.branch]) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.globalAlpha = flick * env;
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(124, 58, 237, 0.95)";
        ctx.strokeStyle = "rgba(124, 58, 237, 0.7)";
        ctx.lineWidth = path === b.pts ? 4.5 : 2.5;
        ctx.beginPath();
        path.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#f5f3ff";
        ctx.lineWidth = path === b.pts ? 1.6 : 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Cosmos                                                              */
/* ------------------------------------------------------------------ */

function createCosmosRenderer(initW: number, initH: number): FrameRenderer {
  interface Dot {
    r: number;
    a: number;
    size: number;
    color: string;
    ph: number;
  }
  interface Star {
    x: number;
    y: number;
    size: number;
    ph: number;
    sp: number;
    color: string;
    bright: boolean;
  }
  interface Comet {
    at: number;
    sx: number;
    sy: number;
    dx: number;
    dy: number;
  }

  const palette = ["#4f46e5", "#7c3aed", "#c026d3", "#0ea5e9", "#ec4899"];
  const dots: Dot[] = Array.from({ length: 420 }, () => {
    const arm = Math.floor(Math.random() * 2);
    const r = Math.pow(Math.random(), 0.65);
    return {
      r,
      a: arm * Math.PI + r * 4.2 + (Math.random() - 0.5) * (0.35 + r * 0.35),
      size: 0.7 + Math.random() * 1.7,
      color: palette[Math.min(palette.length - 1, Math.floor(r * palette.length + Math.random() * 0.8))]!,
      ph: Math.random() * Math.PI * 2,
    };
  });
  const stars: Star[] = Array.from({ length: 70 }, (_, i) => ({
    x: Math.random() * initW,
    y: Math.random() * initH,
    size: 0.8 + Math.random() * 1.5,
    ph: Math.random() * Math.PI * 2,
    sp: 0.003 + Math.random() * 0.005,
    color: palette[Math.floor(Math.random() * palette.length)]!,
    bright: i % 9 === 0,
  }));
  const nebulae = [
    { x: 0.04, y: 0.1, r: 0.42, rgb: "192, 38, 211", a: 0.3 },
    { x: 0.96, y: 0.9, r: 0.45, rgb: "14, 165, 233", a: 0.3 },
    { x: 0.55, y: -0.05, r: 0.34, rgb: "99, 102, 241", a: 0.26 },
    { x: 0.02, y: 0.9, r: 0.3, rgb: "236, 72, 153", a: 0.22 },
  ];
  // Constellation drawn star-to-star across the upper sky (normalised).
  const constel: Array<[number, number]> = [
    [0.16, 0.26],
    [0.25, 0.13],
    [0.38, 0.2],
    [0.48, 0.09],
    [0.6, 0.18],
    [0.7, 0.1],
  ];
  const comets: Comet[] = [
    { at: 650, sx: 0.95, sy: 0.4, dx: -0.45, dy: 0.28 },
    { at: 1700, sx: 0.55, sy: 0.04, dx: -0.4, dy: 0.3 },
    { at: 2600, sx: 1.0, sy: 0.55, dx: -0.55, dy: 0.22 },
  ];

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const m = Math.min(w, h);
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Nebula clouds in the corners (centre stays clear).
    for (const n of nebulae) {
      const x = (n.x + Math.sin(elapsedMs * 0.0004 + n.r * 9) * 0.015) * w;
      const y = (n.y + Math.cos(elapsedMs * 0.00035 + n.r * 7) * 0.015) * h;
      drawGlow(ctx, x, y, Math.max(w, h) * n.r, n.rgb, n.a * env);
    }

    // 2. Stars, with diffraction spikes on the bright ones.
    for (const s of stars) {
      const tw = 0.25 + 0.75 * Math.abs(Math.sin(elapsedMs * s.sp + s.ph));
      if (s.bright) {
        drawSparkle(ctx, s.x, s.y, s.size * 2.4, "#ffffff", s.color, tw * env);
      } else {
        ctx.save();
        ctx.globalAlpha = tw * env;
        drawGlow(ctx, s.x, s.y, s.size * 3.5, "124, 58, 237", 0.2);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. Spiral galaxy anchored in the upper right, partly off-canvas.
    const gx = w * 0.82;
    const gy = h * 0.26;
    const GR = m * 0.52 * easeOutCubic(clamp01(t / 0.32));
    if (GR > 2) {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(-0.5);
      ctx.scale(1, 0.52);
      drawGlow(ctx, 0, 0, GR * 0.95, "168, 85, 247", 0.32 * env);
      drawGlow(ctx, 0, 0, GR * 0.32, "253, 224, 71", 0.7 * env);
      const spin = elapsedMs * 0.00018;
      for (const d of dots) {
        const a = d.a + spin * (1.5 - d.r);
        ctx.globalAlpha = (0.5 + 0.5 * Math.sin(elapsedMs * 0.004 + d.ph)) * env;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d.r * GR, Math.sin(a) * d.r * GR, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Constellation links itself together.
    const cp = clamp01((t - 0.12) / 0.45) * (constel.length - 1);
    ctx.save();
    ctx.globalAlpha = env;
    ctx.strokeStyle = "rgba(79, 70, 229, 0.85)";
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(129, 140, 248, 0.9)";
    ctx.beginPath();
    for (let i = 0; i < constel.length - 1; i += 1) {
      if (cp <= i) break;
      const f = Math.min(1, cp - i);
      const [x0, y0] = constel[i]!;
      const [x1, y1] = constel[i + 1]!;
      ctx.moveTo(x0 * w, y0 * h);
      ctx.lineTo(lerp(x0, x1, f) * w, lerp(y0, y1, f) * h);
    }
    ctx.stroke();
    ctx.restore();
    constel.forEach(([x, y], i) => {
      if (cp + 0.2 < i) return;
      const pulse = 0.7 + 0.3 * Math.sin(elapsedMs * 0.006 + i);
      drawSparkle(ctx, x * w, y * h, 2.6 * pulse, "#ffffff", "#4f46e5", env);
    });

    // 5. Big ringed planet rising from the lower left, with an orbiting moon.
    const pr = m * 0.22;
    const px = w * 0.12;
    const py = lerp(h * 1.25, h * 0.9, easeOutCubic(clamp01(t / 0.35)));
    const ma = elapsedMs * 0.0013;
    const moonX = px + Math.cos(ma) * pr * 2.1;
    const moonY = py - pr * 0.5 + Math.sin(ma) * pr * 0.5;
    const mr = pr * 0.2;
    const drawMoon = () => {
      const g = ctx.createRadialGradient(moonX + mr * 0.3, moonY - mr * 0.3, 0, moonX, moonY, mr);
      g.addColorStop(0, "#f1f5f9");
      g.addColorStop(1, "#64748b");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(moonX, moonY, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(51, 65, 85, 0.7)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    };
    ctx.save();
    ctx.globalAlpha = env;
    if (Math.sin(ma) < 0) drawMoon();
    ctx.save();
    ctx.translate(px, py);
    const ring = (front: boolean) => {
      ctx.save();
      ctx.rotate(-0.3);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
      ctx.lineWidth = pr * 0.16;
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * 1.7, pr * 0.44, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(146, 64, 14, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * 1.5, pr * 0.38, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    ring(false);
    drawGlow(ctx, 0, 0, pr * 1.5, "56, 189, 248", 0.28);
    const sphere = ctx.createRadialGradient(pr * 0.45, -pr * 0.45, pr * 0.1, 0, 0, pr * 1.05);
    sphere.addColorStop(0, "#fed7aa");
    sphere.addColorStop(0.45, "#f97316");
    sphere.addColorStop(1, "#431407");
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(124, 45, 18, 0.32)";
    ctx.lineWidth = pr * 0.11;
    for (const by of [-0.5, -0.15, 0.2, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(-pr, pr * by);
      ctx.quadraticCurveTo(0, pr * (by + 0.12), pr, pr * by);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(125, 211, 252, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, pr, -Math.PI * 0.9, -Math.PI * 0.1);
    ctx.stroke();
    ring(true);
    ctx.restore();
    if (Math.sin(ma) >= 0) drawMoon();
    ctx.restore();

    // 6. Comets with long violet tails.
    for (const c of comets) {
      const p = (elapsedMs - c.at) / 900;
      if (p < 0 || p > 1) continue;
      const hx = (c.sx + c.dx * p) * w;
      const hy = (c.sy + c.dy * p) * h;
      const tp = Math.max(0, p - 0.34);
      const tx = (c.sx + c.dx * tp) * w;
      const ty = (c.sy + c.dy * tp) * h;
      const fade = Math.sin(p * Math.PI) * env;
      ctx.save();
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, "rgba(124, 58, 237, 0)");
      g.addColorStop(1, `rgba(124, 58, 237, ${0.9 * fade})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      drawGlow(ctx, hx, hy, 12, "192, 132, 252", 0.75 * fade);
      drawSparkle(ctx, hx, hy, 2.8, "#ffffff", "#7c3aed", fade);
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Snow                                                                */
/* ------------------------------------------------------------------ */

function drawFlake(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(14, 165, 233, 0.95)";
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (i * Math.PI) / 3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (u: number, v: number): [number, number] => [(u * c - v * s) * r, (u * s + v * c) * r];
    ctx.moveTo(0, 0);
    ctx.lineTo(...at(1, 0));
    for (const b of [0.45, 0.72]) {
      ctx.moveTo(...at(b, 0));
      ctx.lineTo(...at(b + 0.17, 0.2));
      ctx.moveTo(...at(b, 0));
      ctx.lineTo(...at(b + 0.17, -0.2));
    }
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function createSnowRenderer(initW: number, initH: number): FrameRenderer {
  interface Flake {
    x: number;
    y: number;
    z: number;
    size: number;
    rot: number;
    spin: number;
    ph: number;
  }
  const initM = Math.min(initW, initH);
  const flakes: Flake[] = Array.from({ length: 70 }, () => {
    const z = 0.4 + Math.random() * 0.6;
    return {
      x: Math.random() * initW * 1.1,
      y: Math.random() * initH,
      z,
      size: initM * (0.012 + z * 0.032),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.03,
      ph: Math.random() * Math.PI * 2,
    };
  });
  const icicles = Array.from({ length: 40 }, (_, i) => 0.03 + hash(i * 3.7) * 0.07);
  let lastMs = 0;

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const dt = Math.min(3, Math.max(0.2, (elapsedMs - lastMs) / 16.67));
    lastMs = elapsedMs;
    const m = Math.min(w, h);
    const env = envelope(t);
    const gust = Math.sin(elapsedMs * 0.0012) * 0.35;

    ctx.clearRect(0, 0, w, h);

    // 1. Frost glow hugging the left, right and top edges.
    for (const side of [0, 1]) {
      const x0 = side === 0 ? 0 : w;
      const g = ctx.createLinearGradient(x0, 0, side === 0 ? w * 0.14 : w * 0.86, 0);
      g.addColorStop(0, `rgba(125, 211, 252, ${0.4 * env})`);
      g.addColorStop(1, "rgba(125, 211, 252, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(side === 0 ? 0 : w * 0.86, 0, w * 0.14, h);
    }

    // 2. Icicles grow down from the top edge.
    const grow = easeOutCubic(clamp01(t / 0.3));
    const n = Math.max(14, Math.round(w / 22));
    for (let i = 0; i < n; i += 1) {
      const x = ((i + 0.5) / n) * w;
      const len = h * icicles[i % icicles.length]! * grow;
      const bw = (w / n) * 0.42;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.95 * env})`);
      g.addColorStop(1, `rgba(125, 211, 252, ${0.75 * env})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - bw, 0);
      ctx.lineTo(x + bw, 0);
      ctx.lineTo(x + bw * 0.1, len);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.85 * env})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 3. Snow drifts pile up along the bottom edge.
    const pile = easeOutCubic(clamp01((t - 0.05) / 0.5));
    const hillBase = h - m * 0.075 * pile;
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 36) {
        const y =
          hillBase +
          layer * m * 0.02 -
          Math.sin((x / w) * Math.PI * 3 + layer * 1.7) * m * 0.025 * pile -
          Math.sin((x / w) * Math.PI * 7 + layer) * m * 0.008 * pile;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, hillBase - m * 0.03, 0, h);
      g.addColorStop(0, layer === 0 ? "#ffffff" : "#e0f2fe");
      g.addColorStop(1, "#bae6fd");
      ctx.globalAlpha = env;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 4. Falling crystals in depth: near flakes are bigger, faster and sharper.
    for (const f of flakes) {
      f.y += (0.0016 + f.z * 0.0032) * h * dt;
      f.x += (gust * f.z + Math.sin(elapsedMs * 0.0016 + f.ph) * 0.35) * dt;
      f.rot += f.spin * dt;
      if (f.y > h + 12) {
        f.y = -12;
        f.x = Math.random() * w * 1.1;
      }
      if (f.x > w + 12) f.x = -12;
      if (f.x < -12) f.x = w + 12;
      const a = (0.45 + 0.55 * f.z) * env;
      if (f.size > m * 0.026) {
        drawFlake(ctx, f.x, f.y, f.size, f.rot, a);
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        drawGlow(ctx, f.x, f.y, f.size * 1.8, "125, 211, 252", 0.3);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(14, 165, 233, 0.9)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. A few ice glints.
    for (let i = 0; i < 8; i += 1) {
      const x = hash(i * 5.3) * w;
      const y = hash(i * 9.1) * h * 0.8;
      const tw = Math.abs(Math.sin(elapsedMs * 0.004 + i * 1.7));
      drawSparkle(ctx, x, y, 2.2, "#ffffff", "#0ea5e9", tw * env);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Lantern                                                             */
/* ------------------------------------------------------------------ */

function createLanternRenderer(initW: number, initH: number): FrameRenderer {
  interface Lantern {
    x: number;
    y0: number;
    size: number;
    speed: number;
    ph: number;
    rgb: string;
    deep: string;
  }
  const palette: Array<[string, string]> = [
    ["239, 68, 68", "127, 29, 29"],
    ["249, 115, 22", "124, 45, 18"],
    ["245, 158, 11", "120, 53, 15"],
  ];
  const initM = Math.min(initW, initH);
  const lanterns: Lantern[] = Array.from({ length: 16 }, (_, i) => {
    const near = Math.random();
    const pal = palette[i % palette.length]!;
    return {
      x: initW * (0.04 + Math.random() * 0.92),
      y0: initH * (0.55 + Math.random() * 0.75),
      size: initM * (0.05 + near * 0.07),
      speed: 0.000075 + near * 0.00006,
      ph: Math.random() * Math.PI * 2,
      rgb: pal[0],
      deep: pal[1],
    };
  });
  const embers = Array.from({ length: 30 }, () => ({
    x: Math.random(),
    y: Math.random(),
    sp: 0.00004 + Math.random() * 0.00006,
    ph: Math.random() * Math.PI * 2,
  }));

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const env = envelope(t);

    ctx.clearRect(0, 0, w, h);

    // 1. Warm embers drifting up between the lanterns.
    for (const e of embers) {
      const y = (((e.y - elapsedMs * e.sp) % 1) + 1) % 1;
      const x = e.x + Math.sin(elapsedMs * 0.002 + e.ph) * 0.01;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(elapsedMs * 0.005 + e.ph));
      drawSparkle(ctx, x * w, y * h, 1.6, "#fde047", "#b45309", tw * env * 0.9);
    }

    // 2. Sky lanterns rise, sway and flicker; each has a halo, paper ribs and a tassel.
    const sorted = [...lanterns].sort((a, b) => a.size - b.size);
    for (const l of sorted) {
      const rise = elapsedMs * l.speed * h;
      const y = l.y0 - rise;
      const x = l.x + Math.sin(elapsedMs * 0.0012 + l.ph) * l.size * 0.35;
      const s = l.size;
      if (y < -s * 2) continue;
      const flick = 0.82 + 0.18 * Math.sin(elapsedMs * 0.013 + l.ph * 3) * Math.sin(elapsedMs * 0.007 + l.ph);
      const a = env * clamp01((h + s - y) / (h * 0.25));

      ctx.save();
      ctx.globalAlpha = a;
      drawGlow(ctx, x, y, s * 2.6, l.rgb, 0.5 * flick);
      ctx.translate(x, y);
      ctx.rotate(Math.sin(elapsedMs * 0.0014 + l.ph) * 0.06);

      const bw = s * 0.46;
      const bh = s * 0.6;
      const body = ctx.createLinearGradient(-bw, 0, bw, 0);
      body.addColorStop(0, `rgba(${l.deep}, 1)`);
      body.addColorStop(0.35, `rgba(${l.rgb}, ${0.95 * flick})`);
      body.addColorStop(0.5, `rgba(254, 240, 138, ${flick})`);
      body.addColorStop(0.65, `rgba(${l.rgb}, ${0.95 * flick})`);
      body.addColorStop(1, `rgba(${l.deep}, 1)`);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.7, -bh);
      ctx.bezierCurveTo(-bw * 1.5, -bh * 0.55, -bw * 1.5, bh * 0.55, -bw * 0.7, bh);
      ctx.lineTo(bw * 0.7, bh);
      ctx.bezierCurveTo(bw * 1.5, bh * 0.55, bw * 1.5, -bh * 0.55, bw * 0.7, -bh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(${l.deep}, 0.9)`;
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.stroke();
      // ribs
      ctx.strokeStyle = `rgba(${l.deep}, 0.55)`;
      ctx.lineWidth = 1;
      for (const k of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(k * bw * 0.9, -bh);
        ctx.quadraticCurveTo(k * bw * 2.1, 0, k * bw * 0.9, bh);
        ctx.stroke();
      }
      // gold caps
      ctx.fillStyle = "#b45309";
      ctx.fillRect(-bw * 0.72, -bh - s * 0.05, bw * 1.44, s * 0.08);
      ctx.fillRect(-bw * 0.72, bh - s * 0.03, bw * 1.44, s * 0.08);
      // tassel
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath();
      ctx.moveTo(0, bh + s * 0.05);
      ctx.lineTo(Math.sin(elapsedMs * 0.003 + l.ph) * s * 0.05, bh + s * 0.36);
      ctx.stroke();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(Math.sin(elapsedMs * 0.003 + l.ph) * s * 0.05, bh + s * 0.38, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Arcade                                                              */
/* ------------------------------------------------------------------ */

const INVADER_A = [
  "..#.....#..",
  "...#...#...",
  "..#######..",
  ".##.###.##.",
  "###########",
  "#.#######.#",
  "#.#.....#.#",
  "...##.##...",
];
const INVADER_B = [
  "..#.....#..",
  "#..#...#..#",
  "#.#######.#",
  "###.###.###",
  "###########",
  ".#########.",
  "..#.....#..",
  ".#.......#.",
];
const CANNON = [
  ".....#.....",
  "....###....",
  "....###....",
  ".#########.",
  "###########",
  "###########",
];
const HEART_PX = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];

function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  x: number,
  y: number,
  px: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] === "#") ctx.fillRect(Math.round(x + c * px), Math.round(y + r * px), px, px);
    }
  }
}

function createArcadeRenderer(initW: number, initH: number): FrameRenderer {
  interface Alien {
    col: number;
    row: number;
    killAt: number;
  }
  const COLS = 7;
  const ROWS = 3;
  const order = Array.from({ length: COLS * ROWS }, (_, i) => i).sort(
    (a, b) => hash(a * 1.7) - hash(b * 1.7),
  );
  const aliens: Alien[] = Array.from({ length: COLS * ROWS }, (_, i) => ({
    col: i % COLS,
    row: Math.floor(i / COLS),
    killAt: 800 + order.indexOf(i) * 125,
  }));
  const rowColors = ["#ec4899", "#8b5cf6", "#06b6d4"];
  const pstars = Array.from({ length: 40 }, () => ({
    x: Math.random() * initW,
    y: Math.random() * initH,
    ph: Math.random() * Math.PI * 2,
  }));
  let cannonX = initW / 2;
  const bits: Array<{ x: number; y: number; vx: number; vy: number; born: number; color: string }> = [];
  const exploded = new Set<number>();

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const m = Math.min(w, h);
    const env = envelope(t);
    const px = Math.max(2, Math.round(m * 0.011));
    const aw = 11 * px;
    const gapX = aw * 0.7;
    const gapY = px * 4;
    const gridW = COLS * aw + (COLS - 1) * gapX;
    const march = Math.round((Math.sin(elapsedMs * 0.0011) * w * 0.12) / (px * 2)) * px * 2;
    const baseX = (w - gridW) / 2 + march;
    const baseY = h * 0.1 + Math.floor(elapsedMs / 1200) * px * 1.5;
    const frame = Math.floor(elapsedMs / 450) % 2;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = env;

    // 1. Blinking pixel stars.
    for (const s of pstars) {
      if (Math.sin(elapsedMs * 0.004 + s.ph) > 0.2) {
        ctx.fillStyle = "#6366f1";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), px * 0.6 + 1, px * 0.6 + 1);
      }
    }

    // 2. Invaders march; the cannon shoots them one by one in a random order.
    let targetX = cannonX;
    let nextKill = Infinity;
    for (const al of aliens) {
      const ax = baseX + al.col * (aw + gapX);
      const ay = baseY + al.row * (8 * px + gapY);
      const dead = elapsedMs >= al.killAt;
      if (!dead) {
        drawSprite(ctx, frame === 0 ? INVADER_A : INVADER_B, ax, ay, px, rowColors[al.row]!);
        if (al.killAt < nextKill) {
          nextKill = al.killAt;
          targetX = ax + aw / 2;
        }
        const lead = al.killAt - elapsedMs;
        if (lead > 0 && lead < 170) {
          const k = 1 - lead / 170;
          const by = lerp(h - px * 12, ay + 8 * px, k);
          ctx.fillStyle = "#f59e0b";
          ctx.fillRect(lerp(cannonX, ax + aw / 2, k) - px / 2, by, px, px * 3);
        }
      } else if (!exploded.has(al.killAt)) {
        exploded.add(al.killAt);
        for (let i = 0; i < 12; i += 1) {
          const a = (i / 12) * Math.PI * 2;
          bits.push({
            x: ax + aw / 2,
            y: ay + 4 * px,
            vx: Math.cos(a) * (0.05 + Math.random() * 0.06),
            vy: Math.sin(a) * (0.05 + Math.random() * 0.06),
            born: elapsedMs,
            color: rowColors[al.row]!,
          });
        }
      }
    }
    // pixel explosions
    for (let i = bits.length - 1; i >= 0; i -= 1) {
      const b = bits[i]!;
      const age = elapsedMs - b.born;
      if (age > 420) {
        bits.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = env * (1 - age / 420);
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x + b.vx * age * 1.6 * (m / 300)), Math.round(b.y + b.vy * age * 1.6 * (m / 300)), px, px);
    }
    ctx.globalAlpha = env;

    // 3. Player cannon at the bottom, sliding to line up with its target.
    cannonX = lerp(cannonX, targetX, 0.18);
    drawSprite(ctx, CANNON, cannonX - 5.5 * px, h - px * 9, px, "#10b981");

    // 4. HUD: lives, score and a blinking 1UP.
    const hudFont = Math.max(10, Math.round(m * 0.036));
    ctx.font = `700 ${hudFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#4f46e5";
    ctx.textAlign = "left";
    ctx.fillText(Math.floor(elapsedMs / 300) % 2 === 0 ? "1UP" : "   ", px * 3, px * 3);
    for (let i = 0; i < 3; i += 1) drawSprite(ctx, HEART_PX, px * 3 + i * px * 9, px * 3 + hudFont + px, Math.max(1, px * 0.7), "#ef4444");
    const killed = aliens.filter((al) => elapsedMs >= al.killAt).length;
    ctx.textAlign = "right";
    ctx.fillStyle = "#4f46e5";
    ctx.fillText(`SCORE ${String(killed * 150).padStart(5, "0")}`, w - px * 3, px * 3);

    // 5. Spinning coins pop out of two "?" blocks on the lower margins.
    for (const side of [0, 1]) {
      const bx = side === 0 ? w * 0.06 : w * 0.94 - px * 8;
      const by = h * 0.62;
      const bump = Math.max(0, Math.sin(elapsedMs * 0.007 + side * 2.2)) * px * 1.5;
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(bx, by - bump, px * 8, px * 8);
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by - bump, px * 8, px * 8);
      ctx.fillStyle = "#78350f";
      ctx.textAlign = "center";
      ctx.fillText("?", bx + px * 4, by - bump + px * 1.2);
      const k = ((elapsedMs * 0.0016 + side * 0.5) % 1);
      const cy = by - px * 3 - Math.sin(k * Math.PI) * px * 14;
      ctx.save();
      ctx.translate(bx + px * 4, cy);
      ctx.scale(Math.max(0.15, Math.abs(Math.cos(elapsedMs * 0.012))), 1);
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, px * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
}

/* ------------------------------------------------------------------ */
/* Koi                                                                 */
/* ------------------------------------------------------------------ */

function createKoiRenderer(initW: number, initH: number): FrameRenderer {
  interface Koi {
    rx: number;
    ry: number;
    phase: number;
    speed: number;
    dir: 1 | -1;
    scale: number;
    base: string;
    spot: string;
  }
  const koi: Koi[] = [
    { rx: 0.42, ry: 0.36, phase: 0, speed: 0.00065, dir: 1, scale: 1, base: "#f97316", spot: "#dc2626" },
    { rx: 0.36, ry: 0.3, phase: 2.1, speed: 0.0007, dir: -1, scale: 0.85, base: "#ffffff", spot: "#ea580c" },
    { rx: 0.46, ry: 0.4, phase: 4.2, speed: 0.0006, dir: 1, scale: 0.95, base: "#fbbf24", spot: "#ffffff" },
    { rx: 0.3, ry: 0.26, phase: 1.1, speed: 0.00078, dir: -1, scale: 0.7, base: "#ef4444", spot: "#ffffff" },
  ];
  const petals = Array.from({ length: 14 }, () => ({
    x: Math.random() * initW,
    y: Math.random() * initH,
    ph: Math.random() * Math.PI * 2,
    sp: 0.01 + Math.random() * 0.02,
  }));
  const ripples: Array<{ x: number; y: number; born: number }> = [];
  let lastRipple = 0;
  const N = 16;

  const lily = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1, 0.62);
    ctx.fillStyle = "#16a34a";
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0.25, Math.PI * 2 - 0.05);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  const lotus = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, bloom: number) => {
    ctx.save();
    ctx.translate(x, y);
    for (let layer = 0; layer < 2; layer += 1) {
      const n = layer === 0 ? 8 : 6;
      for (let i = 0; i < n; i += 1) {
        ctx.save();
        ctx.rotate((i / n) * Math.PI * 2 + layer * 0.4);
        const L = r * (layer === 0 ? 1 : 0.68) * bloom;
        const g = ctx.createLinearGradient(0, 0, 0, -L);
        g.addColorStop(0, "#fde68a");
        g.addColorStop(0.3, "#fbcfe8");
        g.addColorStop(1, "#ec4899");
        ctx.fillStyle = g;
        ctx.strokeStyle = "rgba(157, 23, 77, 0.75)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(L * 0.45, -L * 0.25, L * 0.4, -L * 0.85, 0, -L);
        ctx.bezierCurveTo(-L * 0.4, -L * 0.85, -L * 0.45, -L * 0.25, 0, 0);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16 * bloom, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  return (ctx, w, h, elapsedMs) => {
    const t = clamp01(elapsedMs / DURATION_MS);
    const m = Math.min(w, h);
    const env = envelope(t);
    const cx = w * 0.5;
    const cy = h * 0.5;

    ctx.clearRect(0, 0, w, h);

    // 1. Teal pond tint at the edges (centre untouched), plus drifting light caustics.
    const pond = ctx.createRadialGradient(cx, cy, m * 0.35, cx, cy, Math.hypot(w, h) * 0.55);
    pond.addColorStop(0, "rgba(13, 148, 136, 0)");
    pond.addColorStop(1, `rgba(13, 148, 136, ${0.26 * env})`);
    ctx.fillStyle = pond;
    ctx.fillRect(0, 0, w, h);

    // 2. Koi: a chain of spine points that trail the head along an elliptical path.
    const fishes = koi.map((k) => {
      const th = k.phase + elapsedMs * k.speed * k.dir;
      const spine: Array<[number, number]> = [];
      const step = 0.045 * k.dir;
      for (let i = 0; i < N; i += 1) {
        const a = th - i * step;
        const x = cx + Math.cos(a) * k.rx * w;
        const y = cy + Math.sin(a) * k.ry * h;
        spine.push([x, y]);
      }
      return { k, spine, head: spine[0]! };
    });

    for (const { k, spine } of fishes) {
      const L = m * 0.1 * k.scale;
      // lateral wag grows toward the tail
      const pts = spine.map(([x, y], i) => {
        const [nx, ny] = spine[Math.min(N - 1, i + 1)]!;
        const [px0, py0] = spine[Math.max(0, i - 1)]!;
        const tx = px0 - nx;
        const ty = py0 - ny;
        const len = Math.hypot(tx, ty) || 1;
        const off = Math.sin(elapsedMs * 0.007 - i * 0.55) * L * 0.05 * (i / N) * 2;
        return [x + (-ty / len) * off, y + (tx / len) * off, tx / len, ty / len] as [number, number, number, number];
      });
      const widthAt = (i: number) => L * 0.17 * Math.pow(Math.sin((Math.PI * (i + 1.6)) / (N + 2.2)), 0.8) * (1 - (i / N) * 0.35);

      ctx.save();
      ctx.globalAlpha = env;
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(7, 89, 133, 0.35)";
      // tail fin
      const tail = pts[N - 1]!;
      const tailLen = L * 0.55;
      ctx.beginPath();
      ctx.moveTo(tail[0], tail[1]);
      ctx.quadraticCurveTo(
        tail[0] - tail[2] * tailLen * 0.5 + tail[3] * tailLen * 0.6,
        tail[1] - tail[3] * tailLen * 0.5 - tail[2] * tailLen * 0.6,
        tail[0] - tail[2] * tailLen + tail[3] * tailLen * 0.2,
        tail[1] - tail[3] * tailLen - tail[2] * tailLen * 0.2,
      );
      ctx.quadraticCurveTo(
        tail[0] - tail[2] * tailLen * 0.5 - tail[3] * tailLen * 0.6,
        tail[1] - tail[3] * tailLen * 0.5 + tail[2] * tailLen * 0.6,
        tail[0],
        tail[1],
      );
      ctx.fillStyle = `${k.base === "#ffffff" ? "rgba(254, 215, 170, 0.85)" : "rgba(251, 146, 60, 0.75)"}`;
      ctx.fill();
      ctx.shadowBlur = 0;
      // pectoral fins
      for (const side of [-1, 1]) {
        const f = pts[3]!;
        ctx.save();
        ctx.translate(f[0], f[1]);
        ctx.rotate(Math.atan2(f[3], f[2]) + side * (0.9 + Math.sin(elapsedMs * 0.008) * 0.12));
        ctx.fillStyle = "rgba(255, 237, 213, 0.9)";
        ctx.beginPath();
        ctx.ellipse(-L * 0.12, 0, L * 0.13, L * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // body outline
      const body = new Path2D();
      for (let i = 0; i < N; i += 1) {
        const [x, y, tx, ty] = pts[i]!;
        const wd = widthAt(i);
        const px1 = x + (-ty) * wd;
        const py1 = y + tx * wd;
        if (i === 0) body.moveTo(px1, py1);
        else body.lineTo(px1, py1);
      }
      for (let i = N - 1; i >= 0; i -= 1) {
        const [x, y, tx, ty] = pts[i]!;
        const wd = widthAt(i);
        body.lineTo(x - (-ty) * wd, y - tx * wd);
      }
      body.closePath();
      ctx.fillStyle = k.base;
      ctx.fill(body);
      ctx.save();
      ctx.clip(body);
      ctx.fillStyle = k.spot;
      [2, 6, 10].forEach((i, n) => {
        const [x, y] = pts[i]!;
        ctx.beginPath();
        ctx.ellipse(x, y, L * (0.12 - n * 0.015), L * 0.085, n, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      for (let i = 1; i < N - 2; i += 1) {
        const [x, y, tx, ty] = pts[i]!;
        ctx.beginPath();
        ctx.arc(x - ty * widthAt(i) * -0.25, y + tx * widthAt(i) * -0.25, L * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(124, 45, 18, 0.65)";
      ctx.lineWidth = 1;
      ctx.stroke(body);
      // eyes
      const hd = pts[1]!;
      ctx.fillStyle = "#0f172a";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(hd[0] + side * -hd[3] * widthAt(1) * 0.6, hd[1] + side * hd[2] * widthAt(1) * 0.6, L * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ripple at the head now and then
      if (elapsedMs - lastRipple > 260) {
        lastRipple = elapsedMs;
        ripples.push({ x: pts[0]![0], y: pts[0]![1], born: elapsedMs });
      }
    }

    // 3. Ripples spreading on the surface.
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const r = ripples[i]!;
      const k = (elapsedMs - r.born) / 900;
      if (k >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(14, 116, 144, ${0.5 * (1 - k) * env})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, k * m * 0.1, k * m * 0.075, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Lily pads and blooming lotus in the corners.
    const bloom = easeOutBack(clamp01((t - 0.05) / 0.35));
    ctx.save();
    ctx.globalAlpha = env;
    lily(ctx, w * 0.07, h * 0.16, m * 0.1, 0.6);
    lily(ctx, w * 0.14, h * 0.3, m * 0.07, 2.4);
    lily(ctx, w * 0.93, h * 0.84, m * 0.11, 3.7);
    lily(ctx, w * 0.86, h * 0.7, m * 0.07, 5.2);
    lily(ctx, w * 0.92, h * 0.14, m * 0.075, 1.4);
    lily(ctx, w * 0.08, h * 0.86, m * 0.08, 4.6);
    lotus(ctx, w * 0.07, h * 0.15, m * 0.07, Math.max(0.01, bloom));
    lotus(ctx, w * 0.93, h * 0.84, m * 0.08, Math.max(0.01, bloom));
    ctx.restore();

    // 5. Petals floating on the water.
    for (const p of petals) {
      const x = (p.x + elapsedMs * p.sp * 0.5) % w;
      const y = p.y + Math.sin(elapsedMs * 0.002 + p.ph) * 5;
      ctx.save();
      ctx.globalAlpha = 0.85 * env;
      ctx.translate(x, y);
      ctx.rotate(p.ph + elapsedMs * 0.0004);
      ctx.fillStyle = "#fbcfe8";
      ctx.strokeStyle = "#be185d";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, m * 0.012, m * 0.007, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Per-effect configuration                                            */
/* ------------------------------------------------------------------ */

type EffectId = Exclude<WelcomeEffect, "">;

interface EffectMeta {
  create: (w: number, h: number) => FrameRenderer;
  Icon: LucideIcon;
  /** Icon colour inside the dark greeting card. */
  cardIconClass: string;
  /** Icon colour inside the light/dark popover badge. */
  badgeIconClass: string;
  /** Edge-only tint behind the canvas; never darkens the centre. */
  backdrop: string;
  card: string;
  accent: string;
}

const EFFECT_META: Record<EffectId, EffectMeta> = {
  phoenix: {
    create: createPhoenixRenderer,
    Icon: Flame,
    cardIconClass: "text-amber-300",
    badgeIconClass: "text-orange-500 dark:text-orange-400",
    backdrop: "bg-[radial-gradient(ellipse_at_50%_105%,rgba(234,88,12,0.2),transparent_62%)]",
    card: "border-orange-400/60 bg-zinc-950/88 text-orange-50 shadow-orange-500/30",
    accent: "via-amber-400",
  },
  hacker: {
    create: createHackerRenderer,
    Icon: Terminal,
    cardIconClass: "text-emerald-400",
    badgeIconClass: "text-emerald-600 dark:text-emerald-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(6,78,59,0.14)_100%)]",
    card: "border-emerald-400/70 bg-zinc-950/92 font-mono text-emerald-300 shadow-emerald-500/30",
    accent: "via-emerald-400",
  },
  admin: {
    create: createAdminRenderer,
    Icon: Crown,
    cardIconClass: "text-amber-300",
    badgeIconClass: "text-amber-500 dark:text-amber-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_52%,rgba(180,83,9,0.15)_100%)]",
    card: "border-amber-300/70 bg-slate-950/90 text-amber-50 shadow-amber-400/30",
    accent: "via-amber-300",
  },
  aurora: {
    create: createAuroraRenderer,
    Icon: Sparkles,
    cardIconClass: "text-sky-300",
    badgeIconClass: "text-sky-500 dark:text-sky-400",
    backdrop: "bg-[linear-gradient(to_bottom,rgba(79,70,229,0.14),transparent_42%)]",
    card: "border-sky-300/60 bg-slate-950/85 text-sky-50 shadow-sky-500/30",
    accent: "via-sky-300",
  },
  sakura: {
    create: createSakuraRenderer,
    Icon: Flower2,
    cardIconClass: "text-pink-300",
    badgeIconClass: "text-pink-500 dark:text-pink-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(236,72,153,0.12)_100%)]",
    card: "border-pink-300/60 bg-zinc-950/88 text-pink-50 shadow-pink-500/30",
    accent: "via-pink-300",
  },
  fireworks: {
    create: createFireworksRenderer,
    Icon: PartyPopper,
    cardIconClass: "text-fuchsia-300",
    badgeIconClass: "text-fuchsia-500 dark:text-fuchsia-400",
    backdrop: "bg-[linear-gradient(to_bottom,rgba(30,27,75,0.12),transparent_45%)]",
    card: "border-fuchsia-300/60 bg-slate-950/88 text-fuchsia-50 shadow-fuchsia-500/30",
    accent: "via-fuchsia-300",
  },
  ocean: {
    create: createOceanRenderer,
    Icon: Waves,
    cardIconClass: "text-cyan-300",
    badgeIconClass: "text-cyan-600 dark:text-cyan-400",
    backdrop: "bg-[linear-gradient(to_top,rgba(14,165,233,0.14),transparent_40%)]",
    card: "border-cyan-300/60 bg-slate-950/88 text-cyan-50 shadow-cyan-500/30",
    accent: "via-cyan-300",
  },
  neon: {
    create: createNeonRenderer,
    Icon: Zap,
    cardIconClass: "text-fuchsia-300",
    badgeIconClass: "text-fuchsia-600 dark:text-fuchsia-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(192,38,211,0.12)_100%)]",
    card: "border-fuchsia-400/70 bg-zinc-950/92 text-fuchsia-50 shadow-fuchsia-500/40",
    accent: "via-cyan-300",
  },
  vice: {
    create: createViceRenderer,
    Icon: Sunset,
    cardIconClass: "text-pink-300",
    badgeIconClass: "text-pink-500 dark:text-pink-400",
    backdrop:
      "bg-[linear-gradient(to_bottom,rgba(236,72,153,0.16),transparent_40%,transparent_62%,rgba(124,58,237,0.16))]",
    card: "border-pink-400/70 bg-[#1e0b36]/92 text-pink-50 shadow-pink-500/40",
    accent: "via-orange-300",
  },
  storm: {
    create: createStormRenderer,
    Icon: CloudLightning,
    cardIconClass: "text-violet-300",
    badgeIconClass: "text-violet-600 dark:text-violet-400",
    backdrop: "bg-[radial-gradient(ellipse_at_50%_0%,rgba(71,85,105,0.2),transparent_55%)]",
    card: "border-violet-300/60 bg-slate-950/90 text-violet-50 shadow-violet-500/30",
    accent: "via-violet-300",
  },
  cosmos: {
    create: createCosmosRenderer,
    Icon: Orbit,
    cardIconClass: "text-indigo-300",
    badgeIconClass: "text-indigo-600 dark:text-indigo-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(76,29,149,0.16)_100%)]",
    card: "border-indigo-300/60 bg-slate-950/90 text-indigo-50 shadow-indigo-500/30",
    accent: "via-fuchsia-300",
  },
  snow: {
    create: createSnowRenderer,
    Icon: Snowflake,
    cardIconClass: "text-sky-200",
    badgeIconClass: "text-sky-500 dark:text-sky-300",
    backdrop: "bg-[linear-gradient(to_bottom,rgba(125,211,252,0.18),transparent_35%)]",
    card: "border-sky-200/70 bg-slate-950/88 text-sky-50 shadow-sky-400/30",
    accent: "via-sky-200",
  },
  lantern: {
    create: createLanternRenderer,
    Icon: Lamp,
    cardIconClass: "text-amber-300",
    badgeIconClass: "text-red-500 dark:text-amber-400",
    backdrop: "bg-[radial-gradient(ellipse_at_50%_110%,rgba(220,38,38,0.2),transparent_60%)]",
    card: "border-amber-300/70 bg-red-950/90 text-amber-50 shadow-red-500/40",
    accent: "via-amber-300",
  },
  arcade: {
    create: createArcadeRenderer,
    Icon: Gamepad2,
    cardIconClass: "text-fuchsia-300",
    badgeIconClass: "text-violet-600 dark:text-violet-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(99,102,241,0.14)_100%)]",
    card: "border-violet-400/70 bg-indigo-950/92 font-mono text-violet-100 shadow-violet-500/40",
    accent: "via-fuchsia-400",
  },
  koi: {
    create: createKoiRenderer,
    Icon: Fish,
    cardIconClass: "text-orange-300",
    badgeIconClass: "text-orange-500 dark:text-orange-400",
    backdrop: "bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(13,148,136,0.18)_100%)]",
    card: "border-teal-300/60 bg-teal-950/90 text-teal-50 shadow-teal-500/30",
    accent: "via-orange-300",
  },
};

/* ------------------------------------------------------------------ */
/* Overlay component                                                   */
/* ------------------------------------------------------------------ */

export function WelcomeEffectOverlay({
  effect,
  ownerName,
  message,
  onComplete,
  contained = false,
}: WelcomeEffectOverlayProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fading, setFading] = useState(false);
  const [reducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
      : false,
  );

  useEffect(() => {
    if (!effect) {
      onComplete();
      return;
    }

    const fadeTimer = window.setTimeout(() => setFading(true), FADE_START_MS);
    const doneTimer = window.setTimeout(() => onComplete(), DURATION_MS);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [effect, onComplete]);

  useEffect(() => {
    if (!effect || reducedMotion) return;
    const meta = EFFECT_META[effect];
    if (!meta) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const getSize = () => {
      if (contained && canvas.parentElement) {
        return {
          width: canvas.parentElement.clientWidth || 640,
          height: canvas.parentElement.clientHeight || 360,
        };
      }
      return { width: window.innerWidth, height: window.innerHeight };
    };

    const resize = () => {
      const { width, height } = getSize();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const { width: initW, height: initH } = getSize();
    const renderFrame = meta.create(initW, initH);

    const startTime = performance.now();
    const tick = (now: number) => {
      const { width, height } = getSize();
      renderFrame(ctx, width, height, now - startTime);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [effect, reducedMotion, contained]);

  if (!effect) return null;
  // Unknown value (e.g. a newer preset saved by a newer server): fall back to Aurora styling.
  const meta = EFFECT_META[effect] ?? EFFECT_META.aurora;
  const BadgeIcon = meta.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none inset-0 flex items-center justify-center transition-opacity duration-700",
        contained ? "absolute z-20" : "fixed z-50",
        meta.backdrop,
        fading ? "opacity-0" : "opacity-100",
      )}
    >
      {!reducedMotion ? (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
      ) : null}

      {message?.trim() ? (
        <div
          className={cn(
            "relative mx-4 flex max-w-md flex-col items-center gap-2 overflow-hidden rounded-xl border px-7 py-5 text-center shadow-2xl backdrop-blur-md transition-transform duration-500",
            meta.card,
            fading ? "scale-95" : "scale-100 animate-in fade-in zoom-in-95",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
              meta.accent,
            )}
          />
          <div className="flex size-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25">
            <BadgeIcon className={cn("size-6", meta.cardIconClass)} aria-hidden />
          </div>
          <p className="text-lg font-semibold tracking-tight">
            {t("welcomeEffect.welcomeTo", { name: ownerName })}
          </p>
          <p className="text-sm leading-relaxed opacity-90">{message.trim()}</p>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onComplete}
        className="pointer-events-auto absolute top-5 right-5 gap-1.5 shadow-md"
      >
        <X className="size-3.5" aria-hidden />
        {t("welcomeEffect.skip")}
      </Button>
    </div>
  );
}

/**
 * Frosted theme pill badge placed in the corner of the quick-profile cover,
 * matching WikiHub's surface token aesthetic.
 */
export function WelcomePopoverBadge({ effect }: { effect: WelcomeEffect }) {
  const { t } = useTranslation();
  if (!effect) return null;
  const meta = EFFECT_META[effect];
  if (!meta) return null;
  const Icon = meta.Icon;

  return (
    <span className="border-border/70 bg-surface/85 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-2xs backdrop-blur-sm">
      <Icon className={cn("size-3", meta.badgeIconClass)} aria-hidden />
      {t(`welcomeEffect.presets.${effect}.label`)}
    </span>
  );
}

/**
 * Kept as a lightweight hook point for the quick-profile popover body.
 * Currently returns null to preserve the clean `bg-surface` card body
 * without background gradient washes.
 */
export function WelcomePopoverEffect({ effect: _effect }: { effect: WelcomeEffect }) {
  return null;
}
